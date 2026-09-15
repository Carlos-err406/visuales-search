use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize, Deserialize)]
pub struct Resource {
    url: String,
    name: String,
    kind: String,
    #[serde(default)]
    revision: u64,
}

#[derive(Default)]
pub struct LibraryWindows {
    resources: Mutex<HashMap<String, Resource>>,
    next: Mutex<u64>,
    navigation: Mutex<Option<String>>,
}

async fn resource(app: &tauri::AppHandle, url: String) -> Result<Resource, String> {
    serde_json::from_value(
        crate::sidecar::request(app, "library.resource", json!({"url": url})).await?,
    )
    .map_err(|error| error.to_string())
}

// All registry changes and window creation run on the UI thread, including concurrent opens.
fn open(
    app: &tauri::AppHandle,
    item: Resource,
    background: bool,
    refresh: bool,
    replace: Option<String>,
) -> Result<String, String> {
    let state = app.state::<LibraryWindows>();
    let existing = state
        .resources
        .lock()
        .unwrap()
        .iter()
        .find(|(_, current)| current.url == item.url)
        .map(|(label, _)| label.clone());
    if let Some(label) = existing {
        if let Some(window) = app.get_webview_window(&label) {
            if refresh {
                let mut resources = state.resources.lock().unwrap();
                let current = resources.get_mut(&label).unwrap();
                current.revision += 1;
                window
                    .emit("library-window-changed", &*current)
                    .map_err(|e| e.to_string())?;
            }
            if !background {
                window.show().map_err(|e| e.to_string())?;
                window.unminimize().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            }
            return Ok(label);
        }
        state.resources.lock().unwrap().remove(&label);
    }
    if let Some(label) = replace {
        let window = app
            .get_webview_window(&label)
            .ok_or("Preview window is closed")?;
        let mut resources = state.resources.lock().unwrap();
        let current = resources.get(&label).ok_or("Not a library window")?;
        if current.kind != "preview" || item.kind != "preview" {
            return Err("Only previews can change their resource".into());
        }
        resources.insert(label.clone(), item.clone());
        window.set_title(&item.name).map_err(|e| e.to_string())?;
        window
            .emit("library-window-changed", &item)
            .map_err(|e| e.to_string())?;
        return Ok(label);
    }
    let label = {
        let mut next = state.next.lock().unwrap();
        *next += 1;
        format!("library-{}", *next)
    };
    let folder = item.kind == "folder";
    let mut item = item;
    item.revision = u64::from(refresh);
    state
        .resources
        .lock()
        .unwrap()
        .insert(label.clone(), item.clone());
    let result = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App("index.html?library-window".into()),
    )
    .title(&item.name)
    .inner_size(
        if folder { 1240.0 } else { 820.0 },
        if folder { 820.0 } else { 680.0 },
    )
    .min_inner_size(
        if folder { 760.0 } else { 480.0 },
        if folder { 620.0 } else { 360.0 },
    )
    .resizable(true)
    .focused(!background)
    .build();
    match result {
        Ok(window) => {
            let handle = app.clone();
            let closed_label = label.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    handle
                        .state::<LibraryWindows>()
                        .resources
                        .lock()
                        .unwrap()
                        .remove(&closed_label);
                }
            });
            Ok(label)
        }
        Err(error) => {
            state.resources.lock().unwrap().remove(&label);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn open_library_window(
    app: tauri::AppHandle,
    url: String,
    background: Option<bool>,
    refresh: Option<bool>,
) -> Result<String, String> {
    let item = resource(&app, url).await?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(open(
            &handle,
            item,
            background.unwrap_or(false),
            refresh.unwrap_or(false),
            None,
        ));
    })
    .map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn navigate_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<String, String> {
    let item = resource(&app, url).await?;
    let label = window.label().to_string();
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(open(&handle, item, false, false, Some(label)));
    })
    .map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_window_context(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Option<Resource> {
    app.state::<LibraryWindows>()
        .resources
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
}

#[tauri::command]
pub fn close_library_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if !app
        .state::<LibraryWindows>()
        .resources
        .lock()
        .unwrap()
        .contains_key(window.label())
    {
        return Err("Not a library window".into());
    }
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn show_in_search(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Same validation as a resource window; navigation never loads a remote page into a webview.
    let item = resource(&app, url).await?;
    *app.state::<LibraryWindows>().navigation.lock().unwrap() = Some(item.url);
    crate::windows::present_main_window(&app)?;
    app.emit_to("main", "show-in-search", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_search_navigation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Option<String> {
    if window.label() != "main" {
        return None;
    }
    app.state::<LibraryWindows>()
        .navigation
        .lock()
        .unwrap()
        .take()
}

#[tauri::command]
pub async fn cached_library_preview(app: tauri::AppHandle, url: String) -> Result<Value, String> {
    crate::sidecar::request(&app, "library.preview.cached", json!({"url":url})).await
}

#[tauri::command]
pub async fn library_preview_status(app: tauri::AppHandle, url: String) -> Result<Value, String> {
    crate::sidecar::request(&app, "library.preview.status", json!({"url":url})).await
}

#[tauri::command]
pub async fn has_downloaded_library_file(
    app: tauri::AppHandle,
    url: String,
) -> Result<bool, String> {
    Ok(
        crate::sidecar::request(&app, "library.local", json!({"url":url}))
            .await?
            .is_string(),
    )
}

#[tauri::command]
pub async fn reveal_library_file(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let path = crate::sidecar::request(&app, "library.local", json!({"url":url})).await?;
    let path = path
        .as_str()
        .ok_or("No completed local file was found")?
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
