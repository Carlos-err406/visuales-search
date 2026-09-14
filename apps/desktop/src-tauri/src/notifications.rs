use serde::Deserialize;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    task_id: String,
    name: String,
    status: Status,
    at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Completed,
    Failed,
}

impl Notice {
    fn title(&self) -> &'static str {
        match self.status {
            Status::Completed => "Download completed",
            Status::Failed => "Download failed",
        }
    }

    fn eligible(&self, focused: bool, now: u64) -> bool {
        !focused && now.checked_sub(self.at).is_some_and(|age| age <= 30_000)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn foreground(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(true))
}

pub async fn poll(app: &tauri::AppHandle) {
    // Drain even in the foreground. Suppressed events must not become late alerts.
    let value = match crate::sidecar::request(app, "notifications.take", json!({})).await {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Could not read download notifications: {error}");
            return;
        }
    };
    let notices = match serde_json::from_value::<Vec<Notice>>(value) {
        Ok(notices) => notices,
        Err(error) => {
            eprintln!("Invalid download notifications: {error}");
            return;
        }
    };
    for notice in notices {
        if notice.eligible(foreground(app), now_ms()) && available(app) {
            let app = app.clone();
            // Native delivery/DBus can block; never stall transfer monitoring or the UI.
            tauri::async_runtime::spawn_blocking(move || {
                if notice.eligible(foreground(&app), now_ms()) && available(&app) {
                    if let Err(error) = show(&app, &notice) {
                        eprintln!("Could not deliver download notification: {error}");
                    }
                }
            });
        }
    }
}

fn available(app: &tauri::AppHandle) -> bool {
    !app.state::<crate::task_monitor::TaskMonitor>().is_stopped()
        && !app.state::<crate::sidecar::SidecarState>().is_suspended()
}

#[cfg(debug_assertions)]
pub fn preview_on_launch(app: &tauri::AppHandle) {
    if !std::env::args().any(|arg| arg == "--notification-preview") {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        tauri::async_runtime::spawn_blocking(move || {
            let notice = Notice {
                task_id: String::new(),
                name: "Notification preview - no files were downloaded".into(),
                status: Status::Completed,
                at: now_ms(),
            };
            // Explicit developer preview bypasses focus/preferences, never the OS policy.
            match show(&app, &notice) {
                Ok(()) => eprintln!("Notification preview submitted to the operating system"),
                Err(error) => eprintln!("Notification preview failed: {error}"),
            }
        });
    });
}

fn show(app: &tauri::AppHandle, notice: &Notice) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    // Do not put URLs, output paths, or potentially sensitive server errors on the lock screen.
    let name: String = notice
        .name
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect();
    notification
        .summary(notice.title())
        .body(&name)
        .appname("Visuales");
    #[cfg(target_os = "macos")]
    {
        // Like Tauri's desktop adapter, macOS delivery requires a registered app bundle.
        // The adapter rejects every set_application call after the first one.
        static APPLICATION: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
        APPLICATION
            .get_or_init(|| {
                notify_rust::set_application(&app.config().identifier)
                    .map_err(|error| error.to_string())
            })
            .clone()?;
    }
    #[cfg(target_os = "windows")]
    notification.app_id(&app.config().identifier);
    #[cfg(target_os = "linux")]
    {
        let name = name
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        notification
            .body(&name)
            .icon("visuales-desktop")
            .hint(notify_rust::Hint::DesktopEntry("visuales-desktop".into()))
            .action("default", "Open download");
        let handle = notification.show().map_err(|error| error.to_string())?;
        let app = app.clone();
        let id = notice.task_id.clone();
        // Bound listener lifetime even when a notification server never reports dismissal.
        tauri::async_runtime::spawn(async move {
            let action = handle.wait_for_action_async(|action| {
                if opens_download(action) && available(&app) {
                    let target = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Err(error) = crate::tray::open_downloads(target, Some(id)) {
                            eprintln!("Could not open notified download: {error}");
                        }
                    });
                }
            });
            let _ = tokio::time::timeout(std::time::Duration::from_secs(300), action).await;
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        // notify-rust 4.17 (also used by Tauri) has no macOS/Windows activation callback.
        let _ = &notice.task_id;
        notification.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn opens_download(action: &notify_rust::ActionResponse<'_>) -> bool {
    matches!(action, notify_rust::ActionResponse::Custom("default"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn only_default_notification_action_opens_download() {
        use notify_rust::{ActionResponse, CloseReason};

        assert!(opens_download(&ActionResponse::Custom("default")));
        assert!(!opens_download(&ActionResponse::Custom("other")));
        assert!(!opens_download(&ActionResponse::Closed(
            CloseReason::Dismissed
        )));
    }

    #[test]
    fn only_fresh_background_terminal_events_are_eligible() {
        let notice: Notice = serde_json::from_value(json!({
            "taskId": "a", "name": "Album", "status": "completed", "at": 1000
        }))
        .unwrap();
        assert_eq!(notice.title(), "Download completed");
        assert!(notice.eligible(false, 1000));
        assert!(notice.eligible(false, 31000));
        assert!(!notice.eligible(true, 1000));
        assert!(!notice.eligible(false, 31001));
        assert!(!notice.eligible(false, 999));
        assert!(serde_json::from_value::<Notice>(json!({
            "taskId": "a", "name": "Album", "status": "interrupted", "at": 1000
        }))
        .is_err());
        assert_eq!(
            Notice {
                status: Status::Failed,
                ..notice
            }
            .title(),
            "Download failed"
        );
    }
}
