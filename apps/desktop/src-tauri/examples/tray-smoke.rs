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
fn click_icon(app: &tauri::AppHandle, rect: tauri::Rect) -> Result<(), String> {
    tray::handle_popup_click(app, tauri::tray::MouseButtonState::Down, rect)?;
    tray::handle_popup_click(app, tauri::tray::MouseButtonState::Up, rect)
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
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    if !popup.is_visible().unwrap() || !popup.is_focused().unwrap() {
                        return Err("popup not visible and focused".into());
                    }
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    if popup.is_visible().unwrap() || !main.is_minimized().unwrap() {
                        return Err("second tray click should close popup without restoring main".into());
                    }
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    // Reproduce a focus-loss callback queued before mouse-down.
                    tray::handle_popup_focus(&app, false);
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    if popup.is_visible().unwrap() || !main.is_minimized().unwrap() {
                        return Err("focus loss before a tray click reopened popup or main".into());
                    }
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    // Keep the original close intent if the press outlasts blur dismissal.
                    tray::handle_popup_click(&app, tauri::tray::MouseButtonState::Down, rect)?;
                    tray::dismiss_tray(app.clone())?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    tray::handle_popup_click(&app, tauri::tray::MouseButtonState::Up, rect)?;
                    if popup.is_visible().unwrap() || !main.is_minimized().unwrap() {
                        return Err("long tray press reopened popup or main".into());
                    }
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    // A queued blur must not close a popup opened by a newer click.
                    tray::handle_popup_focus(&app, false);
                    click_icon(&app, rect)?;
                    click_icon(&app, rect)?;
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    if !popup.is_visible().unwrap() {
                        return Err("stale blur closed the newly reopened popup".into());
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
                    click_icon(&app, rect)?;
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
                            "tray toggle, blur races, focus dismissal, minimized Downloads navigation passed",
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
