use serde_json::{json, Value};
use std::{
    future::Future,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::sync::{Mutex, Notify};

type Reply = Result<Value, String>;

#[derive(Default)]
struct SnapshotCache {
    value: Mutex<Option<(Instant, u64, Reply)>>,
    revision: AtomicU64,
}

impl SnapshotCache {
    async fn read<F, Fut>(&self, fetch: F) -> Reply
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Reply>,
    {
        // Hold the async lock across the read: popup, main window, and native
        // polling share one reconciliation, including failures.
        let mut slot = self.value.lock().await;
        let revision = self.revision.load(Ordering::SeqCst);
        if let Some((at, version, value)) = &*slot {
            if at.elapsed() < Duration::from_secs(2) && *version == revision {
                return value.clone();
            }
        }
        let value = fetch().await;
        *slot = Some((Instant::now(), revision, value.clone()));
        value
    }
}

#[derive(Default)]
pub struct TaskMonitor {
    cache: SnapshotCache,
    stopped: AtomicBool,
    wake: Notify,
}

impl TaskMonitor {
    pub fn invalidate(&self) {
        self.cache.revision.fetch_add(1, Ordering::SeqCst);
        self.wake.notify_one();
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }
}

pub async fn snapshot(app: &tauri::AppHandle) -> Reply {
    let monitor = app.state::<TaskMonitor>();
    let available = || {
        !monitor.stopped.load(Ordering::SeqCst)
            && !app.state::<crate::sidecar::SidecarState>().is_suspended()
    };
    if !available() {
        return Err("Transfer status unavailable".into());
    }
    let result = monitor
        .cache
        .read(|| crate::sidecar::request(app, "tasks.snapshot", json!({})))
        .await;
    // Never publish a late snapshot after updater suspension or exit.
    if !available() {
        return Err("Transfer status unavailable".into());
    }
    result
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let monitor = app.state::<TaskMonitor>();
        loop {
            if monitor.stopped.load(Ordering::SeqCst) {
                break;
            }
            let request = snapshot(&app);
            tokio::pin!(request);
            let value = tokio::select! {
                value = &mut request => value,
                _ = tokio::time::sleep(Duration::from_secs(8)) => {
                    crate::tray::update_status(&app, None);
                    // Keep awaiting the existing read, not a second request.
                    request.await
                }
            };
            if monitor.stopped.load(Ordering::SeqCst) {
                break;
            }
            crate::tray::update_status(&app, value.as_ref().ok());
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(2)) => {},
                _ = monitor.wake.notified() => {},
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn concurrent_reads_share_success_and_failure() {
        let cache = SnapshotCache::default();
        let calls = AtomicU64::new(0);
        let fetch = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(json!({"tasks": []}))
        };
        let (a, b) = tokio::join!(cache.read(fetch), cache.read(fetch));
        assert_eq!(a, b);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        cache.revision.fetch_add(1, Ordering::SeqCst);
        assert!(cache
            .read(|| async { Err("offline".into()) })
            .await
            .is_err());
        assert!(cache
            .read(|| async { panic!("failure must be cached too") })
            .await
            .is_err());
    }

    #[tokio::test]
    async fn invalidation_during_read_is_not_lost() {
        let cache = SnapshotCache::default();
        cache
            .read(|| async {
                cache.revision.fetch_add(1, Ordering::SeqCst);
                Ok(json!(1))
            })
            .await
            .unwrap();
        assert_eq!(
            cache.read(|| async { Ok(json!(2)) }).await.unwrap(),
            json!(2)
        );
    }
}
