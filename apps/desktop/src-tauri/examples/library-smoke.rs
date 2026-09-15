// Exercise native window lifetime without starting the sidecar or touching user transfers.
#[path = "../src/library_windows.rs"]
mod library_windows;
#[path = "../src/windows.rs"]
mod windows;
mod sidecar {
    pub async fn request(
        _: &tauri::AppHandle,
        _: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let url = args["url"].as_str().ok_or("missing URL")?;
        Ok(
            serde_json::json!({"url":url,"name":"Library window test","kind":if url.ends_with('/') {"folder"} else {"preview"}}),
        )
    }
}

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
    context.config_mut().identifier = "cu.uclv.visuales.library-test".into();
    tauri::Builder::default()
        .manage(library_windows::LibraryWindows::default())
        .invoke_handler(tauri::generate_handler![library_windows::library_window_context])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External("about:blank".parse()?))
                .title("Visuales library window test").inner_size(400.0, 240.0).build()?;
            Ok(())
        })
        .build(context).expect("build library smoke app")
        .run(move |app, event| {
            windows::handle_event(app, &event);
            if !matches!(event, tauri::RunEvent::Ready) { return; }
            let app = app.clone();
            let directory = directory.clone();
            tauri::async_runtime::spawn(async move {
                let wait = || tokio::time::sleep(Duration::from_millis(700));
                let result: Result<(), String> = async {
                    wait().await;
                    let main = app.get_webview_window("main").ok_or("missing main")?;
                    main.set_focus().map_err(|e| e.to_string())?;
                    wait().await;
                    if !main.is_focused().unwrap() { return Err("fixture main window did not acquire focus before opening preview".into()); }
                    let url = "https://visuales.uclv.cu/test/one.png".to_string();
                    let label = library_windows::open_library_window(app.clone(), url.clone(), Some(true), None).await?;
                    wait().await;
                    let preview = app.get_webview_window(&label).ok_or("missing preview")?;
                    if !preview.is_visible().unwrap() || preview.is_focused().unwrap() || !main.is_focused().unwrap() {
                        return Err(format!("background preview: visible={}, focused={}, main focused={}", preview.is_visible().unwrap(), preview.is_focused().unwrap(), main.is_focused().unwrap()));
                    }
                    let same = library_windows::open_library_window(app.clone(), url.clone(), None, None).await?;
                    wait().await;
                    if same != label || !preview.is_focused().unwrap() { return Err("duplicate preview was not focused".into()); }
                    let second = "https://visuales.uclv.cu/test/two.png".to_string();
                    let navigated = library_windows::navigate_preview(app.clone(), preview.clone(), second.clone()).await?;
                    if navigated != label { return Err("navigation created a new window".into()); }
                    let same = library_windows::open_library_window(app.clone(), second, None, None).await?;
                    if same != label { return Err("navigated resource was not deduplicated".into()); }
                    let folder_label = library_windows::open_library_window(app.clone(), "https://visuales.uclv.cu/test/".into(), None, None).await?;
                    let folder = app.get_webview_window(&folder_label).ok_or("missing folder")?;
                    library_windows::close_library_window(app.clone(), preview).map_err(|e| e.to_string())?;
                    wait().await;
                    if app.get_webview_window(&label).is_some() || app.get_webview_window("main").is_none() { return Err("closing preview affected main window".into()); }
                    library_windows::close_library_window(app.clone(), folder)?;
                    wait().await;
                    if app.get_webview_window("main").is_none() { return Err("closing folder closed app".into()); }
                    Ok(())
                }.await;
                match result {
                    Ok(()) => { fs::write(directory.join("passed"), "Background focus, deduplication, navigation and independent close passed").unwrap(); app.exit(0); }
                    Err(error) => { fs::write(directory.join("failed"), error).unwrap(); app.exit(1); }
                }
            });
        });
}
