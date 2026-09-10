mod folders;
mod sidecar;
mod updates;

use serde_json::{json, Value};
use tauri::Manager;

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
) -> Result<Value, String> {
    sidecar::request(
        &app,
        "search",
        json!({ "terms": terms, "noCache": no_cache }),
    )
    .await
}

#[tauri::command]
async fn list_library_directory(
    app: tauri::AppHandle,
    url: String,
    refresh: bool,
) -> Result<Value, String> {
    sidecar::request(
        &app,
        "library.list",
        json!({ "url": url, "refresh": refresh }),
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
async fn list_download_tasks(app: tauri::AppHandle) -> Result<Value, String> {
    sidecar::request(&app, "tasks.list", json!({})).await
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
    sidecar::request(
        &app,
        "settings.save",
        json!({ "settings": settings, "defaultOutput": default_output_dir()? }),
    )
    .await
}

#[tauri::command]
async fn start_download(
    app: tauri::AppHandle,
    urls: Vec<String>,
    output: Option<String>,
    queue: Option<bool>,
) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    sidecar::request(
        &app,
        "download.start",
        json!({ "urls": urls, "output": output, "queue": queue.unwrap_or(false), "defaultOutput": default_output_dir()? }),
    )
    .await
}

#[tauri::command]
async fn cancel_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sidecar::request(&app, "tasks.cancel", json!({ "id": id })).await
}

#[tauri::command]
async fn delete_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sidecar::request(&app, "tasks.delete", json!({ "id": id })).await
}

#[tauri::command]
async fn resume_download_task(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let updates = app.state::<updates::UpdateState>();
    let _guard = updates.transfers.read().await;
    updates.ensure_downloads_allowed()?;
    sidecar::request(&app, "tasks.resume", json!({ "id": id })).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(sidecar::SidecarState::default())
        .manage(updates::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            search_content,
            list_library_directory,
            preview_library_file,
            default_output_dir,
            get_desktop_settings,
            save_desktop_settings,
            folders::open_output_folder,
            list_download_tasks,
            start_download,
            cancel_download_task,
            delete_download_task,
            resume_download_task,
            updates::app_update_info,
            updates::check_app_update,
            updates::download_app_update,
            updates::install_app_update,
            updates::restart_after_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building visuales desktop app")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<sidecar::SidecarState>().shutdown();
            }
        });
}
