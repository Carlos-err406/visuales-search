// Uses real Cocoa windows and the production presentation handler, without
// starting the download engine or reading the user's settings/task store.
#[cfg(target_os = "macos")]
#[path = "../src/windows.rs"]
mod windows;

#[cfg(target_os = "macos")]
#[path = "../src/relaunch.rs"]
mod relaunch;

#[cfg(target_os = "macos")]
fn main() {
    use std::{fs, path::PathBuf, time::Duration};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let directory = PathBuf::from(std::env::args_os().nth(1).expect("smoke output directory"));
    let restarted = directory.join("restarting").exists();
    fs::write(
        directory.join(if restarted {
            "restarted.pid"
        } else {
            "started.pid"
        }),
        std::process::id().to_string(),
    )
    .unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "cu.uclv.visuales.relaunch-test".into();
    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External("about:blank".parse()?))
                .title("Visuales relaunch test")
                .inner_size(400.0, 240.0)
                .visible(false)
                .build()?;
            app.hide()?;
            Ok(())
        })
        .build(context)
        .expect("build smoke app")
        .run(move |app, event| {
            windows::handle_event(app, &event);
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                fs::write(
                    directory.join(if restarted {
                        "reopened-after-restart"
                    } else {
                        "reopened"
                    }),
                    b"yes",
                )
                .unwrap();
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) && !restarted {
                fs::write(directory.join("exit-requested"), b"yes").unwrap();
            }
            if matches!(event, tauri::RunEvent::Exit) && !restarted {
                fs::write(directory.join("exit-delivered"), b"yes").unwrap();
            }
            if !matches!(event, tauri::RunEvent::Ready) {
                return;
            }
            let app = app.clone();
            let directory = directory.clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), String> = async {
                    let window = app.get_webview_window("main").ok_or("missing window")?;
                    let check = |stage: &str| -> Result<(), String> {
                        let visible = window.is_visible().map_err(|e| e.to_string())?;
                        let minimized = window.is_minimized().map_err(|e| e.to_string())?;
                        let focused = window.is_focused().map_err(|e| e.to_string())?;
                        if !visible || minimized || !focused {
                            return Err(format!("stage={stage} restarted={restarted} visible={visible} minimized={minimized} focused={focused}"));
                        }
                        Ok(())
                    };
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    check("startup")?;
                    window.minimize().map_err(|e| e.to_string())?;
                    app.hide().map_err(|e| e.to_string())?;
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    let status = std::process::Command::new("/usr/bin/open")
                        .arg("-a")
                        .arg(directory.join("Visuales Relaunch Test.app"))
                        .status()
                        .map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err("could not send the native reopen event".into());
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    check("reopen")?;
                    if !directory
                        .join(if restarted {
                            "reopened-after-restart"
                        } else {
                            "reopened"
                        })
                        .exists()
                    {
                        return Err("native reopen event was not delivered".into());
                    }
                    if restarted {
                        if !directory.join("exit-requested").exists()
                            || !directory.join("exit-delivered").exists()
                        {
                            return Err("restart skipped the exit lifecycle".into());
                        }
                        fs::write(
                            directory.join("passed"),
                            b"visible after startup, reopen, and restart",
                        )
                        .map_err(|e| e.to_string())?;
                        app.exit(0);
                    } else {
                        fs::write(directory.join("restarting"), b"yes")
                            .map_err(|e| e.to_string())?;
                        relaunch::restart(app.clone()).await?;
                    }
                    Ok(())
                }
                .await;
                if let Err(error) = result {
                    eprintln!("{error}");
                    let _ = fs::write(directory.join("failed"), error);
                    app.exit(1);
                }
            });
        });
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This native relaunch smoke test requires macOS.");
}
