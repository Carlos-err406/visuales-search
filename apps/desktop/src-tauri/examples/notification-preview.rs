// Manual native notification preview. Uses production handlers but never starts an engine or transfer monitor.
#![allow(dead_code)]
#[path = "../src/folders.rs"]
mod folders;
#[path = "../src/notifications.rs"]
mod notifications;
#[path = "../src/sidecar.rs"]
mod sidecar;
#[path = "../src/task_monitor.rs"]
mod task_monitor;
#[path = "../src/tray.rs"]
mod tray;
#[path = "../src/windows.rs"]
mod windows;

fn main() {
    #[cfg(debug_assertions)]
    {
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = "cu.uclv.visuales.notification-preview".into();
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .manage(sidecar::SidecarState::default())
            .manage(task_monitor::TaskMonitor::default())
            .manage(tray::TrayState::default())
            .manage(notifications::NotificationActions::default())
            .setup(|app| {
                notifications::setup(app.handle());
                notifications::preview_on_launch(app.handle());
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(180)).await;
                    handle.exit(0);
                });
                Ok(())
            })
            .run(context)
            .expect("Could not run notification preview");
    }
}
