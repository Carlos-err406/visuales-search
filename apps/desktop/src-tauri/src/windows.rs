use tauri::Manager;

pub fn handle_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    let present = match event {
        tauri::RunEvent::Ready => true,
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => true,
        _ => false,
    };
    if present {
        // Queue from a worker: run_on_main_thread executes inline when called
        // on the main thread, before Cocoa has finished its launch callback.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                if let Err(error) = present_main_window(&handle) {
                    eprintln!("Could not show the main window: {error}");
                }
            }) {
                eprintln!("Could not queue main window presentation: {error}");
            }
        });
    }
}

pub fn present_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is missing")?;
    // A process relaunched from inside an app bundle can inherit macOS's hidden
    // application state. Showing its NSWindow alone does not unhide the app.
    #[cfg(target_os = "macos")]
    app.show().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}
