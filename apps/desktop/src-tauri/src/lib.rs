mod folders;
mod library_windows;
mod notifications;
mod quit;
mod relaunch;
mod sidecar;
mod task_monitor;
mod tray;
mod updates;
mod windows;

use serde_json::{json, Value};
use tauri::{Emitter, Manager};

#[tauri::command]
fn default_output_dir() -> Result<String, String> {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .map(|path| path.join("Visuales").to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine the default output directory".to_string())
}

#[tauri::command]
async fn search_content(
    app: tauri::AppHandle,
    terms: Vec<String>,
    no_cache: bool,
    root: Option<String>,
) -> Result<Value, String> {
    let result = sidecar::request(
        &app,
        "search",
        json!({ "terms": terms, "noCache": no_cache, "root": root }),
    )
    .await?;
    if no_cache {
        let _ = app.emit("search-index-changed", ());
    }
    Ok(result)
}

#[tauri::command]
async fn search_index_status(app: tauri::AppHandle) -> Result<Value, String> {
    sidecar::request(&app, "index.status", json!({})).await
}

#[tauri::command]
async fn search_index_control(app: tauri::AppHandle, action: String) -> Result<Value, String> {
    sidecar::request(&app, "index.control", json!({ "action": action })).await
}

#[tauri::command]
async fn list_library_directory(
    app: tauri::AppHandle,
    url: String,
    refresh: bool,
    require_dates: Option<bool>,
) -> Result<Value, String> {
    sidecar::request(
        &app,
        "library.list",
        json!({ "url": url, "refresh": refresh, "requireDates": require_dates.unwrap_or(false) }),
    )
    .await
}

#[tauri::command]
async fn preview_library_file(
    app: tauri::AppHandle,
    url: String,
    refresh: bool,
) -> Result<Value, String> {
    sidecar::request(
        &app,
        "library.preview",
        json!({ "url": url, "refresh": refresh }),
    )
    .await
}

#[tauri::command]
async fn list_download_tasks(
    app: tauri::AppHandle,
    refresh: Option<bool>,
) -> Result<Value, String> {
    if refresh == Some(true) {
        app.state::<task_monitor::TaskMonitor>().invalidate();
    }
    task_monitor::snapshot(&app)
        .await
        .map(|value| value["tasks"].clone())
}

#[tauri::command]
async fn get_download_files(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sidecar::request(&app, "tasks.files", json!({ "id": id })).await
}

#[tauri::command]
async fn get_desktop_settings(app: tauri::AppHandle) -> Result<Value, String> {
    sidecar::request(
        &app,
        "settings.get",
        json!({ "defaultOutput": default_output_dir()? }),
    )
    .await
}

#[tauri::command]
async fn save_desktop_settings(app: tauri::AppHandle, settings: Value) -> Result<Value, String> {
    let next = sidecar::request(
        &app,
        "settings.save",
        json!({ "settings": settings, "defaultOutput": default_output_dir()? }),
    )
    .await?;
    let _ = app.emit("settings-changed", ());
    Ok(next)
}

#[tauri::command]
async fn review_download(
    app: tauri::AppHandle,
    urls: Vec<String>,
    output: Option<String>,
) -> Result<Value, String> {
    sidecar::request(
        &app,
        "download.review",
        json!({ "urls": urls, "output": output, "defaultOutput": default_output_dir()? }),
    )
    .await
}

#[tauri::command]
async fn retry_download_files(
    app: tauri::AppHandle,
    id: String,
    paths: Option<Vec<String>>,
) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    app.state::<quit::QuitState>().ensure_downloads_allowed()?;
    sidecar::request(&app, "tasks.retry", json!({ "id": id, "paths": paths })).await
}

#[tauri::command]
async fn start_download(
    app: tauri::AppHandle,
    urls: Vec<String>,
    output: Option<String>,
    queue: Option<bool>,
    review_id: Option<String>,
) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    app.state::<quit::QuitState>().ensure_downloads_allowed()?;
    sidecar::request(
        &app,
        "download.start",
        json!({ "urls": urls, "output": output, "queue": queue.unwrap_or(false), "reviewId": review_id, "defaultOutput": default_output_dir()? }),
    )
    .await
}

#[tauri::command]
async fn move_queued_download(
    app: tauri::AppHandle,
    id: String,
    position: Value,
) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    app.state::<quit::QuitState>().ensure_downloads_allowed()?;
    sidecar::request(
        &app,
        "tasks.move",
        json!({ "id": id, "position": position }),
    )
    .await
}

#[tauri::command]
async fn cancel_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sidecar::request(&app, "tasks.cancel", json!({ "id": id })).await
}

#[tauri::command]
async fn cancel_all_downloads(app: tauri::AppHandle) -> Result<Value, String> {
    sidecar::request(&app, "tasks.cancelAll", json!({})).await
}

#[tauri::command]
async fn delete_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sidecar::request(&app, "tasks.delete", json!({ "id": id })).await
}

#[tauri::command]
async fn resume_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    resume_task(app, id, false, false).await
}

#[tauri::command]
async fn queue_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    resume_task(app, id, true, false).await
}

#[tauri::command]
async fn retry_failed_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    resume_task(app, id, true, true).await
}

async fn resume_task(
    app: tauri::AppHandle,
    id: String,
    queue: bool,
    failed_only: bool,
) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    app.state::<quit::QuitState>().ensure_downloads_allowed()?;
    sidecar::request(
        &app,
        "tasks.resume",
        json!({ "id": id, "queue": queue, "failedOnly": failed_only }),
    )
    .await
}

#[tauri::command]
async fn open_project_page() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        tauri_plugin_opener::open_url(
            "https://github.com/Carlos-err406/visuales-search",
            None::<&str>,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(windows::state_builder().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(sidecar::SidecarState::default())
        .manage(updates::UpdateState::default())
        .manage(quit::QuitState::default())
        .manage(task_monitor::TaskMonitor::default())
        .manage(notifications::NotificationActions::default())
        .manage(tray::TrayState::default())
        .manage(library_windows::LibraryWindows::default())
        .setup(|app| {
            notifications::setup(app.handle());
            if let Err(error) = tray::setup(app.handle()) {
                eprintln!("Tray unavailable; use the Downloads view: {error}");
            }
            task_monitor::start(app.handle());
            #[cfg(debug_assertions)]
            notifications::preview_on_launch(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_content,
            search_index_status,
            search_index_control,
            list_library_directory,
            preview_library_file,
            library_windows::open_library_window,
            library_windows::navigate_preview,
            library_windows::library_window_context,
            library_windows::close_library_window,
            library_windows::show_in_search,
            library_windows::take_search_navigation,
            library_windows::cached_library_preview,
            library_windows::library_preview_status,
            library_windows::has_downloaded_library_file,
            library_windows::reveal_library_file,
            default_output_dir,
            get_desktop_settings,
            save_desktop_settings,
            folders::open_output_folder,
            open_project_page,
            list_download_tasks,
            get_download_files,
            tray::tray_snapshot,
            tray::dismiss_tray,
            tray::open_downloads,
            tray::take_download_navigation,
            tray::quit_from_tray,
            start_download,
            review_download,
            retry_download_files,
            move_queued_download,
            cancel_download_task,
            cancel_all_downloads,
            delete_download_task,
            resume_download_task,
            queue_download_task,
            retry_failed_download_task,
            updates::app_update_info,
            updates::check_app_update,
            updates::download_app_update,
            updates::install_app_update,
            updates::restart_after_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building visuales desktop app")
        .run(|app, event| {
            windows::handle_event(app, &event);
            quit::handle_event(app, &event);
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<task_monitor::TaskMonitor>().stop();
                app.state::<sidecar::SidecarState>().shutdown();
            }
        });
}
