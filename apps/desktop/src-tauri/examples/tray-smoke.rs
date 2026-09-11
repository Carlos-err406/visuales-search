// Real native tray/window checks, with a fixture snapshot and no user task store.
#[cfg(target_os = "macos")]
#[path = "../src/tray.rs"]
mod tray;
#[cfg(target_os = "macos")]
#[path = "../src/windows.rs"]
mod windows;

#[cfg(target_os = "macos")]
mod task_monitor {
    pub async fn snapshot(_: &tauri::AppHandle) -> Result<serde_json::Value, String> {
        Ok(
            serde_json::json!({"summary": {"running": 0, "queued": 0, "speedBytes": null, "transfers": []}}),
        )
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn list_download_tasks() -> serde_json::Value {
    serde_json::json!([])
}

#[cfg(target_os = "macos")]
fn main() {
    use std::{fs, path::PathBuf, time::Duration};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    let directory = PathBuf::from(std::env::args_os().nth(1).expect("smoke output directory"));
    fs::write(
        directory.join("started.pid"),
        std::process::id().to_string(),
    )
    .unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "cu.uclv.visuales.tray-test".into();
    tauri::Builder::default()
        .manage(tray::TrayState::default())
        .invoke_handler(tauri::generate_handler![
            list_download_tasks,
            tray::tray_snapshot,
            tray::dismiss_tray,
            tray::open_downloads,
            tray::take_download_navigation,
            tray::quit_from_tray
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External("about:blank".parse()?))
                .title("Visuales tray test")
                .inner_size(400.0, 240.0)
                .build()?;
            tray::setup(app.handle())?;
            Ok(())
        })
        .build(context)
        .expect("build tray smoke app")
        .run(move |app, event| {
            windows::handle_event(app, &event);
            if !matches!(event, tauri::RunEvent::Ready) {
                return;
            }
            let app = app.clone();
            let directory = directory.clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), String> = async {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let main = app.get_webview_window("main").ok_or("missing main")?;
                    let popup = app.get_webview_window("tray").ok_or("missing popup")?;
                    if popup.is_visible().unwrap() {
                        return Err("popup should start hidden".into());
                    }
                    let icon = app.tray_by_id("visuales-tray").ok_or("missing tray")?;
                    let rect = icon
                        .rect()
                        .map_err(|e| e.to_string())?
                        .ok_or("missing tray bounds")?;
                    let snapshot = task_monitor::snapshot(&app).await?;
                    tray::update_status(&app, Some(&snapshot));
                    main.minimize().map_err(|e| e.to_string())?;
                    tray::toggle_popup(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    if !popup.is_visible().unwrap() || !popup.is_focused().unwrap() {
                        return Err("popup not visible and focused".into());
                    }
                    tray::open_downloads(app.clone(), Some("fixture-task".into()))?;
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    if popup.is_visible().unwrap()
                        || main.is_minimized().unwrap()
                        || !main.is_focused().unwrap()
                    {
                        return Err("Downloads did not restore main and dismiss popup".into());
                    }
                    if tray::take_download_navigation(app.clone()) != Some("fixture-task".into())
                        || tray::take_download_navigation(app.clone()).is_some()
                    {
                        return Err("navigation not retained exactly once".into());
                    }
                    tray::toggle_popup(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    main.set_focus().map_err(|e| e.to_string())?;
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    if popup.is_visible().unwrap() {
                        return Err("focus loss did not dismiss popup".into());
                    }
                    tray::update_status(&app, None);
                    Ok(())
                }
                .await;
                match result {
                    Ok(()) => {
                        fs::write(
                            directory.join("passed"),
                            "tray, popup, focus dismissal, minimized Downloads navigation passed",
                        )
                        .unwrap();
                        app.exit(0);
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        fs::write(directory.join("failed"), error).unwrap();
                        app.exit(1);
                    }
                }
            });
        });
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This native tray smoke test requires macOS.");
}
