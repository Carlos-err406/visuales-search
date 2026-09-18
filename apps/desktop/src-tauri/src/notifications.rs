use serde::Deserialize;
use serde_json::json;
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg(target_os = "macos")]
#[path = "notifications/macos.rs"]
mod macos;

const MAX_NOTICE_AGE_MS: u64 = 5 * 60 * 1000;
const ACTION_LIFETIME_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_ACTIONS: usize = 100;
const REVEAL_ACTION: &str = "reveal-download";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    task_id: String,
    name: String,
    status: Status,
    at: u64,
    #[serde(default)]
    output: Option<PathBuf>,
    #[serde(skip)]
    preview: bool,
}

#[derive(Clone, Deserialize, PartialEq)]
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
        !focused
            && now
                .checked_sub(self.at)
                .is_some_and(|age| age <= MAX_NOTICE_AGE_MS)
    }

    fn can_reveal(&self) -> bool {
        self.status == Status::Completed
            && self.output.as_ref().is_some_and(|path| path.is_absolute())
    }
}

struct PendingAction {
    id: String,
    notice: Notice,
    created: u64,
    _cancel: tokio::sync::watch::Sender<()>,
}

#[derive(Default)]
pub struct NotificationActions(Mutex<VecDeque<PendingAction>>);

impl NotificationActions {
    fn permits_presentation(&self, id: &str, focused: bool, now: u64) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .find(|entry| entry.id == id)
            .is_some_and(|entry| entry.notice.preview || entry.notice.eligible(focused, now))
    }

    fn register(&self, notice: Notice, now: u64) -> (String, tokio::sync::watch::Receiver<()>) {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let id = format!(
            "visuales-{}-{now}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let (cancel, receiver) = tokio::sync::watch::channel(());
        let mut pending = self.0.lock().unwrap_or_else(|error| error.into_inner());
        pending.retain(|entry| action_is_fresh(entry.created, now));
        while pending.len() >= MAX_ACTIONS {
            pending.pop_front();
        }
        pending.push_back(PendingAction {
            id: id.clone(),
            notice,
            created: now,
            _cancel: cancel,
        });
        (id, receiver)
    }

    fn take(&self, id: &str, now: u64) -> Option<Notice> {
        let mut pending = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let index = pending.iter().position(|entry| entry.id == id)?;
        let entry = pending.remove(index)?;
        action_is_fresh(entry.created, now).then_some(entry.notice)
    }
}

fn action_is_fresh(created: u64, now: u64) -> bool {
    now.checked_sub(created)
        .is_some_and(|age| age < ACTION_LIFETIME_MS)
}

fn reveal_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Show in Finder"
    } else if cfg!(target_os = "windows") {
        "Show in File Explorer"
    } else {
        "Open containing folder"
    }
}

#[derive(Debug, PartialEq)]
enum Action {
    Reveal(PathBuf),
    OpenDownload(String),
}

fn action_for(notice: &Notice, action: &str) -> Option<Action> {
    match action {
        REVEAL_ACTION | "default" if notice.can_reveal() => {
            Some(Action::Reveal(notice.output.clone()?))
        }
        "default" => Some(Action::OpenDownload(notice.task_id.clone())),
        _ => None,
    }
}

fn dismiss(app: &tauri::AppHandle, id: &str) {
    app.state::<NotificationActions>().take(id, now_ms());
}

fn activate(app: &tauri::AppHandle, id: &str, action: &str) {
    let Some(notice) = app.state::<NotificationActions>().take(id, now_ms()) else {
        return;
    };
    if !available(app) {
        return;
    }
    match action_for(&notice, action) {
        Some(Action::Reveal(output)) => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if !available(&app) {
                    return;
                }
                if let Err(error) = crate::folders::open_notified_folder(output) {
                    eprintln!("Could not open notified download {}", notice.task_id);
                    let target = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if !available(&target) {
                            return;
                        }
                        let _ = crate::tray::open_downloads(target.clone(), Some(notice.task_id));
                        target
                            .dialog()
                            .message(error)
                            .title("Download folder unavailable")
                            .kind(MessageDialogKind::Warning)
                            .show(|_| {});
                    });
                } else {
                    eprintln!(
                        "Notification action opened download folder for {}",
                        notice.task_id
                    );
                }
            });
        }
        Some(Action::OpenDownload(id)) => {
            let target = app.clone();
            let _ = app.run_on_main_thread(move || {
                if available(&target) {
                    let _ = crate::tray::open_downloads(target, Some(id));
                }
            });
        }
        None => {}
    }
}

pub fn setup(_app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::setup(_app) {
        eprintln!("Notification actions unavailable: {error}");
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
    if !available(app) {
        return;
    }
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
        let focused = foreground(app);
        if notice.eligible(focused, now_ms()) && available(app) {
            let app = app.clone();
            // Native delivery/DBus can block; never stall transfer monitoring or the UI.
            tauri::async_runtime::spawn_blocking(move || {
                if notice.eligible(foreground(&app), now_ms()) && available(&app) {
                    match show(&app, &notice) {
                        Ok(()) => eprintln!(
                            "Download notification {} submitted to the operating system",
                            notice.task_id
                        ),
                        Err(error) => eprintln!(
                            "Could not deliver download notification {}: {error}",
                            notice.task_id
                        ),
                    }
                } else {
                    eprintln!(
                        "Download notification {} suppressed after focus/lifecycle recheck",
                        notice.task_id
                    );
                }
            });
        } else {
            eprintln!(
                "Download notification {} suppressed (focused={focused}, age_ms={})",
                notice.task_id,
                now_ms().saturating_sub(notice.at)
            );
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
                output: dirs::download_dir().or_else(dirs::home_dir),
                preview: true,
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
    // Do not put URLs, output paths, or potentially sensitive server errors on the lock screen.
    let name: String = notice
        .name
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect();
    let (id, mut canceled) = app
        .state::<NotificationActions>()
        .register(notice.clone(), now_ms());
    let expiry_app = app.clone();
    let expiry_id = id.clone();
    let mut expiry_canceled = canceled.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(ACTION_LIFETIME_MS)) => dismiss(&expiry_app, &expiry_id),
            _ = expiry_canceled.changed() => {},
        }
    });
    let result = show_native(app, notice, &name, &id, &mut canceled);
    if result.is_err() {
        dismiss(app, &id);
    }
    result
}

fn show_native(
    app: &tauri::AppHandle,
    notice: &Notice,
    name: &str,
    id: &str,
    _canceled: &mut tokio::sync::watch::Receiver<()>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if macos::is_bundled() {
            return macos::show(app, notice, name, id);
        }
        // Bare cargo-run executables cannot use UNUserNotificationCenter. Keep delivery,
        // without an inert action button; bundled dev previews exercise the real backend.
        dismiss(app, id);
        static APPLICATION: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
        APPLICATION
            .get_or_init(|| {
                notify_rust::set_application(&app.config().identifier)
                    .map_err(|error| error.to_string())
            })
            .clone()?;
        notify_rust::Notification::new()
            .summary(notice.title())
            .body(name)
            .appname("Visuales")
            .show()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        let mut toast = tauri_winrt_notification::Toast::new(&app.config().identifier)
            .title(notice.title())
            .text1(name)
            .sound(None);
        if notice.can_reveal() {
            toast = toast.add_button(reveal_label(), REVEAL_ACTION);
        }
        let target = app.clone();
        let token = id.to_owned();
        let dismiss_target = app.clone();
        let dismiss_token = id.to_owned();
        toast
            .on_activated(move |action| {
                activate(&target, &token, action.as_deref().unwrap_or("default"));
                Ok(())
            })
            .on_dismissed(move |reason| {
                // A timed-out banner can still be activated from Notification Center.
                if matches!(
                    reason,
                    Some(tauri_winrt_notification::ToastDismissalReason::UserCanceled)
                        | Some(tauri_winrt_notification::ToastDismissalReason::ApplicationHidden)
                ) {
                    dismiss(&dismiss_target, &dismiss_token);
                }
                Ok(())
            })
            .show()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let name = name
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let mut notification = notify_rust::Notification::new();
        notification
            .summary(notice.title())
            .appname("Visuales")
            .body(&name)
            .icon("visuales-desktop")
            .hint(notify_rust::Hint::DesktopEntry("visuales-desktop".into()))
            .action(
                "default",
                if notice.can_reveal() {
                    reveal_label()
                } else {
                    "Open download"
                },
            );
        if notice.can_reveal() {
            notification.action(REVEAL_ACTION, reveal_label());
        }
        let handle = notification.show().map_err(|error| error.to_string())?;
        let app = app.clone();
        let id = id.to_owned();
        let mut canceled = _canceled.clone();
        tauri::async_runtime::spawn(async move {
            let action = handle.wait_for_action_async(|action| match action {
                notify_rust::ActionResponse::Custom(action) => activate(&app, &id, action),
                _ => dismiss(&app, &id),
            });
            tokio::select! {
                _ = action => {},
                _ = canceled.changed() => {},
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn completion(id: &str, folder: &str) -> Notice {
        Notice {
            task_id: id.into(),
            name: "A download".into(),
            status: Status::Completed,
            at: 1000,
            output: Some(std::env::temp_dir().join(folder)),
            preview: false,
        }
    }

    #[test]
    fn actions_use_the_completion_destination_once_not_the_current_selection() {
        let actions = NotificationActions::default();
        let first = completion("a", "First folder %20 # (2026)");
        let second = completion("b", "Second folder");
        let (a, receiver) = actions.register(first.clone(), 1000);
        let (b, _) = actions.register(second.clone(), 1000);
        assert_ne!(a, b);
        assert!(
            !a.contains("First folder"),
            "OS payload uses an opaque token"
        );
        assert_eq!(
            action_for(&actions.take(&b, 2000).unwrap(), REVEAL_ACTION),
            Some(Action::Reveal(second.output.unwrap()))
        );
        assert_eq!(
            action_for(&actions.take(&a, 2000).unwrap(), "default"),
            Some(Action::Reveal(first.output.unwrap()))
        );
        assert!(
            actions.take(&a, 2001).is_none(),
            "repeated activations are consumed once"
        );
        assert!(
            receiver.has_changed().is_err(),
            "consumption cancels listener and expiry work"
        );
        assert!(actions.take("unknown", 2000).is_none());
    }

    #[test]
    fn notification_actions_expire_and_evict_without_retaining_listeners() {
        let actions = NotificationActions::default();
        let (oldest, receiver) = actions.register(completion("a", "a"), 1000);
        for _ in 0..MAX_ACTIONS {
            actions.register(completion("b", "b"), 1000);
        }
        assert_eq!(actions.0.lock().unwrap().len(), MAX_ACTIONS);
        assert!(actions.take(&oldest, 1000).is_none());
        assert!(receiver.has_changed().is_err());
        let (id, receiver) = actions.register(completion("c", "c"), 1000);
        assert!(actions.take(&id, 1000 + ACTION_LIFETIME_MS).is_none());
        assert!(receiver.has_changed().is_err());
        actions.register(completion("d", "d"), 1000 + ACTION_LIFETIME_MS);
        assert_eq!(actions.0.lock().unwrap().len(), 1);
        assert!(!action_is_fresh(1000, 999));
    }

    #[test]
    fn failed_legacy_and_invalid_notices_never_reveal_an_arbitrary_target() {
        let mut notice = completion("a", "a");
        for action in [
            "dismiss",
            "__closed",
            "other",
            "https://example.com",
            "file:///tmp",
        ] {
            assert_eq!(action_for(&notice, action), None);
        }
        notice.status = Status::Failed;
        assert_eq!(action_for(&notice, REVEAL_ACTION), None);
        assert_eq!(
            action_for(&notice, "default"),
            Some(Action::OpenDownload("a".into()))
        );
        notice.status = Status::Completed;
        for output in [
            None,
            Some(PathBuf::from("relative/folder")),
            Some(PathBuf::from("https://example.com")),
        ] {
            notice.output = output;
            assert_eq!(action_for(&notice, REVEAL_ACTION), None);
            assert_eq!(
                action_for(&notice, "default"),
                Some(Action::OpenDownload("a".into()))
            );
        }
        assert_eq!(
            reveal_label(),
            if cfg!(target_os = "macos") {
                "Show in Finder"
            } else if cfg!(target_os = "windows") {
                "Show in File Explorer"
            } else {
                "Open containing folder"
            }
        );
    }

    #[test]
    fn delayed_native_presentation_rechecks_focus_age_and_ignores_wire_preview_flags() {
        let actions = NotificationActions::default();
        let notice: Notice = serde_json::from_value(json!({
            "taskId": "a", "name": "A", "status": "completed", "at": 1000, "preview": true
        }))
        .unwrap();
        assert!(!notice.preview);
        let (id, _) = actions.register(notice, 1000);
        assert!(actions.permits_presentation(&id, false, 1000));
        assert!(!actions.permits_presentation(&id, true, 1000));
        assert!(!actions.permits_presentation(&id, false, 1001 + MAX_NOTICE_AGE_MS));
        actions.take(&id, 1000);
        assert!(!actions.permits_presentation(&id, false, 1000));
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
        assert!(
            notice.eligible(false, 31001),
            "a slow refresh must not expire a completion alert"
        );
        assert!(notice.eligible(false, 1000 + MAX_NOTICE_AGE_MS));
        assert!(!notice.eligible(false, 1001 + MAX_NOTICE_AGE_MS));
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
