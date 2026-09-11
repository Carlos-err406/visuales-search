use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex as AsyncMutex},
};

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Reply>>>>;

#[derive(Default)]
pub struct SidecarState {
    bridge: Mutex<Option<Arc<Bridge>>>,
    suspended: AtomicBool,
}

impl SidecarState {
    pub fn is_suspended(&self) -> bool {
        self.suspended.load(Ordering::SeqCst)
    }
    pub fn shutdown(&self) {
        if let Some(bridge) = self.bridge.lock().unwrap().as_ref() {
            if let Some(stop) = bridge.stop.lock().unwrap().take() {
                let _ = stop.send(());
            }
        }
    }

    pub async fn suspend_for_update(&self) -> Result<(), String> {
        self.shutdown_and_wait()
            .await
            .map_err(|_| "Download engine did not stop; update was not installed".to_string())
    }

    pub async fn shutdown_and_wait(&self) -> Result<(), String> {
        let bridge = {
            let slot = self.bridge.lock().unwrap();
            self.suspended.store(true, Ordering::SeqCst);
            slot.clone()
        };
        self.shutdown();
        if let Some(bridge) = bridge {
            tokio::time::timeout(Duration::from_secs(8), async {
                while !bridge.exited.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            })
            .await
            .map_err(|_| "Download engine did not stop".to_string())?;
        }
        Ok(())
    }

    pub fn resume_after_update_error(&self) {
        self.suspended.store(false, Ordering::SeqCst);
    }
}

struct Bridge {
    stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
    pending: Pending,
    sequence: AtomicU64,
    alive: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    initialized: tokio::sync::OnceCell<()>,
}

pub async fn request(app: &tauri::AppHandle, method: &str, params: Value) -> Reply {
    let bridge = {
        let state = app.state::<SidecarState>();
        let mut slot = state.bridge.lock().unwrap();
        if state.suspended.load(Ordering::SeqCst) {
            return Err(
                "App update in progress; restart to reconnect the download engine".to_string(),
            );
        }
        if slot
            .as_ref()
            .is_none_or(|bridge| !bridge.alive.load(Ordering::SeqCst))
        {
            *slot = Some(Arc::new(Bridge::spawn(app)?));
        }
        slot.as_ref().unwrap().clone()
    };
    bridge
        .initialized
        .get_or_try_init(|| async {
            let hello = bridge.call("hello", json!({})).await?;
            if hello["protocolVersion"] != 1 {
                return Err("Unsupported Node engine protocol version".to_string());
            }
            Ok(())
        })
        .await?;
    bridge.call(method, params).await
}

impl Bridge {
    fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let runtime = executable
            .parent()
            .ok_or("Could not locate app directory")?
            .join(format!("visuales-node{}", std::env::consts::EXE_SUFFIX));
        let script = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("resources/sidecar.cjs");
        let app = app.clone();
        Self::spawn_process(runtime, script, move || {
            app.state::<crate::task_monitor::TaskMonitor>().invalidate();
            let _ = app.emit("tasks-changed", ());
        })
    }

    fn spawn_process(
        runtime: std::path::PathBuf,
        script: std::path::PathBuf,
        changed: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let mut command = Command::new(runtime);
        command
            .arg(script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        command.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start Node engine: {error}"))?;
        let stdin = Arc::new(AsyncMutex::new(Some(
            child.stdin.take().ok_or("Missing sidecar stdin")?,
        )));
        let stdout = child.stdout.take().ok_or("Missing sidecar stdout")?;
        let stderr = child.stderr.take().ok_or("Missing sidecar stderr")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let exited = Arc::new(AtomicBool::new(false));
        let (stop, stopped) = oneshot::channel();
        let responses = pending.clone();
        let reader_alive = alive.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(id) = message["id"].as_str() {
                    if let Some(reply) = responses.lock().unwrap().remove(id) {
                        let result = if let Some(error) = message["error"]["message"].as_str() {
                            Err(error.to_string())
                        } else {
                            Ok(message["result"].clone())
                        };
                        let _ = reply.send(result);
                    }
                } else if message["method"] == "tasks.changed" {
                    changed();
                }
            }
            reader_alive.store(false, Ordering::SeqCst);
            for (_, reply) in responses.lock().unwrap().drain() {
                let _ = reply.send(Err(
                    "Node engine disconnected; unfinished downloads can be resumed".to_string(),
                ));
            }
        });
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[visuales] {line}");
            }
        });
        let shutdown_stdin = stdin.clone();
        let process_exited = exited.clone();
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                _ = child.wait() => {},
                _ = stopped => {
                    // Dropping the pipe delivers EOF; poll_shutdown alone does not close it.
                    shutdown_stdin.lock().await.take();
                    if tokio::time::timeout(Duration::from_secs(5), child.wait()).await.is_err() {
                        let _ = child.kill().await;
                    }
                }
            }
            process_exited.store(true, Ordering::SeqCst);
        });
        Ok(Self {
            stdin,
            pending,
            sequence: AtomicU64::new(1),
            alive,
            exited,
            stop: Mutex::new(Some(stop)),
            initialized: tokio::sync::OnceCell::new(),
        })
    }

    async fn call(&self, method: &str, params: Value) -> Reply {
        let id = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let message = format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        );
        let (reply, response) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if !self.alive.load(Ordering::SeqCst) {
                return Err("Node engine is not running".to_string());
            }
            pending.insert(id.clone(), reply);
        }
        let result = async {
            self.stdin
                .lock()
                .await
                .as_mut()
                .ok_or("Node engine is shutting down")?
                .write_all(message.as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            response
                .await
                .map_err(|_| "Node engine disconnected".to_string())?
        };
        // Searches can take minutes on the upstream Apache server.
        let timeout = if method == "search" || method.starts_with("library.") {
            300
        } else {
            30
        };
        let result = tokio::time::timeout(Duration::from_secs(timeout), result)
            .await
            .unwrap_or_else(|_| Err("Node engine request timed out".to_string()));
        self.pending.lock().unwrap().remove(&id);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn routes_concurrent_requests_and_stops_the_real_node_process() {
        let executable = std::env::current_exe().unwrap();
        let runtime = executable
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(format!("visuales-node{}", std::env::consts::EXE_SUFFIX));
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/sidecar.cjs");
        let bridge = Arc::new(Bridge::spawn_process(runtime, script, || {}).unwrap());
        let (hello, invalid) = tokio::join!(
            bridge.call("hello", json!({})),
            bridge.call("invalid", json!({}))
        );
        assert_eq!(hello.unwrap()["protocolVersion"], 1);
        assert!(invalid.unwrap_err().contains("Unknown method"));
        let state = SidecarState {
            bridge: Mutex::new(Some(bridge.clone())),
            suspended: AtomicBool::new(false),
        };
        state.suspend_for_update().await.unwrap();
        assert!(state.suspended.load(Ordering::SeqCst));
        assert!(bridge.exited.load(Ordering::SeqCst));
        assert!(bridge.call("hello", json!({})).await.is_err());
        state.resume_after_update_error();
        assert!(!state.suspended.load(Ordering::SeqCst));
    }
}
