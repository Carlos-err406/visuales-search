use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

#[derive(Default)]
pub struct QuitState {
    pending: AtomicBool,
    approved: AtomicBool,
}

impl QuitState {
    fn begin(&self) -> bool {
        self.pending
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn ensure_downloads_allowed(&self) -> Result<(), String> {
        if self.approved.load(Ordering::SeqCst) {
            Err("Visuales is quitting".to_string())
        } else {
            Ok(())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuitSummary {
    running: u64,
    queued: u64,
    owned_running: u64,
    owned_queued: u64,
}

impl QuitSummary {
    fn warning(&self) -> Result<Option<String>, String> {
        if self.owned_running > self.running || self.owned_queued > self.queued {
            return Err("Invalid transfer ownership".to_string());
        }
        if self.running == 0 && self.queued == 0 {
            return Ok(None);
        }
        let mut message = format!(
            "{} running and {} queued transfers.\n\n",
            self.running, self.queued
        );
        if self.owned_running > 0 || self.owned_queued > 0 {
            message.push_str(&format!(
                "Quitting will stop this app's {} running and {} queued transfers. Partial files are kept; resume them from Downloads or the CLI next time.\n\n",
                self.owned_running, self.owned_queued
            ));
        }
        if self.running > self.owned_running || self.queued > self.owned_queued {
            message.push_str(
                "Transfers started by the CLI or another app instance will keep running.\n\n",
            );
        }
        message.push_str("Quit Visuales?");
        Ok(Some(message))
    }
}

fn confirms_quit(result: MessageDialogResult) -> bool {
    result == MessageDialogResult::Custom("Quit".to_string())
}

async fn confirm(app: &tauri::AppHandle, message: String) -> bool {
    let (send, receive) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .message(message)
        .title("Downloads in progress")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Keep open".into(),
        ));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        let _ = send.send(confirms_quit(result));
    });
    receive.await.unwrap_or(false)
}

pub fn handle_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    let state = app.state::<QuitState>();
    if state.approved.load(Ordering::SeqCst) {
        return;
    }
    let code = match event {
        tauri::RunEvent::ExitRequested { code, api, .. }
            if *code != Some(tauri::RESTART_EXIT_CODE) =>
        {
            api.prevent_exit();
            code.unwrap_or(0)
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            0
        }
        _ => return,
    };
    if !state.begin() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Hold the same gate as installation until the decision is complete. A
        // pending desktop start/resume cannot slip between the snapshot and quit.
        let updates = app.state::<crate::updates::UpdateState>();
        let _guard = updates.transfers.write().await;
        let warning = if updates.ensure_downloads_allowed().is_err() {
            // Installation already verified idle state and stopped this engine.
            Ok(None)
        } else {
            crate::sidecar::request(&app, "tasks.prepareQuit", json!({}))
                .await
                .and_then(|value| {
                    serde_json::from_value::<QuitSummary>(value).map_err(|error| error.to_string())
                })
                .and_then(|summary| summary.warning())
        };
        let approved = match warning {
            Ok(None) => true,
            Ok(Some(message)) => confirm(&app, message).await,
            Err(_) => confirm(&app, "Transfer status could not be checked. Quitting may interrupt this app's downloads. Partial files are kept. CLI transfers will continue.\n\nQuit anyway?".to_string()).await,
        };
        let state = app.state::<QuitState>();
        if approved {
            state.approved.store(true, Ordering::SeqCst);
            // Let owned workers close their files and persist resumable state
            // before ending the native event loop. Never stop external CLI jobs.
            let _ = app
                .state::<crate::sidecar::SidecarState>()
                .shutdown_and_wait()
                .await;
            app.exit(code);
        } else {
            state.pending.store(false, Ordering::SeqCst);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancel_and_dismiss_never_confirm_quit() {
        for result in [
            MessageDialogResult::Cancel,
            MessageDialogResult::Ok,
            MessageDialogResult::Custom("Keep open".into()),
        ] {
            assert!(!confirms_quit(result));
        }
        assert!(confirms_quit(MessageDialogResult::Custom("Quit".into())));
    }
    #[test]
    fn requests_coalesce_and_cancel_allows_retry() {
        let state = QuitState::default();
        assert!(state.begin());
        assert!(!state.begin());
        state.pending.store(false, Ordering::SeqCst);
        assert!(state.begin());
        assert!(state.ensure_downloads_allowed().is_ok());
        state.approved.store(true, Ordering::SeqCst);
        assert!(state.ensure_downloads_allowed().is_err());
    }
    #[test]
    fn warning_distinguishes_owned_and_external_transfers() {
        let mut summary = QuitSummary {
            running: 0,
            queued: 0,
            owned_running: 0,
            owned_queued: 0,
        };
        assert!(summary.warning().unwrap().is_none());
        summary.running = 1;
        let text = summary.warning().unwrap().unwrap();
        assert!(text.contains("will keep running"));
        assert!(!text.contains("will stop"));
        summary.queued = 2;
        summary.owned_queued = 2;
        let text = summary.warning().unwrap().unwrap();
        assert!(text.contains("0 running and 2 queued transfers"));
        assert!(text.contains("will keep running"));
        summary.owned_running = 2;
        assert!(summary.warning().is_err());
    }
}
