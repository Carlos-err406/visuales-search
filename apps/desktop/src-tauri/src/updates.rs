use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex, RwLock};

#[derive(Default)]
pub struct UpdateState {
    session: Mutex<Session>,
    pub transfers: RwLock<()>,
    installed: AtomicBool,
}

#[derive(Default)]
struct Session {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

impl UpdateState {
    pub fn ensure_downloads_allowed(&self) -> Result<(), String> {
        if self.installed.load(Ordering::SeqCst) {
            Err("Restart Visuales to finish the app update before starting downloads".to_string())
        } else {
            Ok(())
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    supported: bool,
    reason: Option<String>,
    automatic: bool,
}

#[tauri::command]
pub fn app_update_info(app: tauri::AppHandle) -> UpdateInfo {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config["pubkey"].as_str());
    let reason = if key.is_none_or(str::is_empty) {
        Some("Updates are not configured in this build.".to_string())
    } else if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        Some("Use the AppImage for in-app updates. Update a .deb installation with your package manager.".to_string())
    } else {
        None
    };
    UpdateInfo {
        current_version: app.package_info().version.to_string(),
        supported: reason.is_none(),
        reason,
        automatic: !cfg!(debug_assertions),
    }
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    received: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<Option<String>, String> {
    let info = app_update_info(app.clone());
    if !info.supported {
        return Err(info.reason.unwrap());
    }
    let mut session = state
        .session
        .try_lock()
        .map_err(|_| "An update operation is already in progress")?;
    if session.bytes.is_some() || state.installed.load(Ordering::SeqCst) {
        return Ok(session.update.as_ref().map(|update| update.version.clone()));
    }
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    session.update = update;
    Ok(session.update.as_ref().map(|update| update.version.clone()))
}

#[tauri::command]
pub async fn download_app_update(
    state: tauri::State<'_, UpdateState>,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    state.ensure_downloads_allowed()?;
    let mut session = state
        .session
        .try_lock()
        .map_err(|_| "An update operation is already in progress")?;
    if session.bytes.is_some() {
        return Ok(());
    }
    let mut update = session.update.clone().ok_or("Check for an update first")?;
    if update.download_url.scheme() != "https"
        || update.download_url.host_str() != Some("github.com")
        || !update
            .download_url
            .path()
            .starts_with("/Carlos-err406/visuales-search/releases/download/")
    {
        return Err("The update URL is not a Visuales release asset".to_string());
    }
    update.timeout = Some(Duration::from_secs(15 * 60));
    let mut received = 0;
    // Tauri verifies the signed bytes before returning them. Never install unverified data.
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = on_progress.send(UpdateProgress { received, total });
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    session.bytes = Some(bytes);
    Ok(())
}

fn ensure_idle(tasks: &Value) -> Result<(), String> {
    let tasks = tasks.as_array().ok_or("Could not verify transfer status")?;
    for task in tasks {
        match task["status"].as_str() {
            Some("completed" | "failed" | "interrupted") => {}
            Some("running" | "queued") => return Err(
                "Finish or cancel running and queued transfers before installing the app update"
                    .to_string(),
            ),
            _ => return Err("Could not verify transfer status".to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let mut session = state
        .session
        .try_lock()
        .map_err(|_| "An update operation is already in progress")?;
    if state.installed.load(Ordering::SeqCst) {
        return Err("The update is already installed; restart Visuales".to_string());
    }
    let update = session.update.clone().ok_or("Check for an update first")?;
    if session.bytes.is_none() {
        return Err("Download and verify the update first".to_string());
    }
    // Serialize against desktop starts/resumes and re-read shared state at install time.
    let _guard = state.transfers.write().await;
    app.state::<crate::quit::QuitState>()
        .ensure_downloads_allowed()?;
    let tasks = crate::sidecar::request(&app, "tasks.prepareUpdate", json!({})).await?;
    ensure_idle(&tasks)?;
    let engine = app.state::<crate::sidecar::SidecarState>();
    if let Err(error) = engine.suspend_for_update().await {
        engine.resume_after_update_error();
        return Err(error);
    }
    let bytes = session.bytes.take().unwrap();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = update.install(&bytes).map_err(|error| error.to_string());
        (bytes, result)
    })
    .await;
    match result {
        Ok((_, Ok(()))) => {
            state.installed.store(true, Ordering::SeqCst);
            Ok(())
        }
        Ok((bytes, Err(error))) => {
            session.bytes = Some(bytes);
            engine.resume_after_update_error();
            Err(error)
        }
        Err(error) => {
            engine.resume_after_update_error();
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn restart_after_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    if !state.installed.load(Ordering::SeqCst) {
        return Err("No installed update is waiting for restart".to_string());
    }
    crate::relaunch::restart(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installation_requires_known_idle_state() {
        assert!(ensure_idle(&json!([])).is_ok());
        for status in ["completed", "failed", "interrupted"] {
            assert!(ensure_idle(&json!([{ "status": status }])).is_ok());
        }
        for status in ["running", "queued", "unknown"] {
            assert!(ensure_idle(&json!([{ "status": status }])).is_err());
        }
        assert!(ensure_idle(&json!({})).is_err());
        assert!(ensure_idle(&json!([{}])).is_err());
    }
    #[test]
    fn installed_updates_block_new_transfers_until_restart() {
        let state = UpdateState::default();
        assert!(state.ensure_downloads_allowed().is_ok());
        state.installed.store(true, Ordering::SeqCst);
        assert!(state.ensure_downloads_allowed().is_err());
    }
}
