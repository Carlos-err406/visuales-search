use serde_json::Value;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
#[cfg(not(target_os = "linux"))]
use tauri::{PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

#[cfg(not(target_os = "linux"))]
const POPUP_WIDTH: f64 = 360.0;
#[cfg(not(target_os = "linux"))]
const POPUP_HEIGHT: f64 = 560.0;

struct TrayUi {
    icon: TrayIcon,
    summary: MenuItem<tauri::Wry>,
    last_label: String,
}

#[derive(Default)]
pub struct TrayState {
    ui: Mutex<Option<TrayUi>>,
    // Retained until the main frontend acknowledges it, including during reload.
    navigation: Mutex<Option<String>>,
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let summary = MenuItem::with_id(app, "tray-status", "Loading transfers", false, None::<&str>)?;
    let downloads = MenuItem::with_id(app, "tray-downloads", "Open Downloads", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Visuales", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &summary,
            &PredefinedMenuItem::separator(app)?,
            &downloads,
            &quit,
        ],
    )?;
    let icon = small_icon(app.default_window_icon().expect("Visuales app icon"));
    let tray = TrayIconBuilder::with_id("visuales-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Visuales - Loading transfers")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-downloads" => {
                if let Err(error) = open_downloads(app.clone(), None) {
                    eprintln!("{error}");
                }
            }
            "tray-quit" => {
                let _ = quit_from_tray(app.clone());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                #[cfg(not(target_os = "linux"))]
                if let Err(error) = toggle_popup(tray.app_handle(), rect) {
                    eprintln!("Could not show transfer popup: {error}");
                    let _ = open_downloads(tray.app_handle().clone(), None);
                }
                #[cfg(target_os = "linux")]
                let _ = (tray, rect);
            }
        })
        .build(app)?;
    *app.state::<TrayState>().ui.lock().unwrap() = Some(TrayUi {
        icon: tray,
        summary,
        last_label: String::new(),
    });
    #[cfg(not(target_os = "linux"))]
    {
        let popup =
            WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html?tray".into()))
                .title("Visuales transfers")
                .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
                .decorations(false)
                .resizable(false)
                .visible(false)
                .focused(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(true)
                .build()?;
        let handle = app.clone();
        popup.on_window_event(move |event| match event {
            tauri::WindowEvent::Focused(false) => {
                let _ = dismiss_tray(handle.clone());
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = dismiss_tray(handle.clone());
            }
            _ => {}
        });
    }
    Ok(())
}

// Downsample the existing brand asset. On macOS its white mark becomes an
// alpha mask; crop the surrounding app-icon padding so the mark fills the
// native 18-point icon height. The OS supplies its foreground color.
fn small_icon(source: &Image<'_>) -> Image<'static> {
    let source_width = source.width() as usize;
    let source_height = source.height() as usize;
    let (left, top, crop_width, crop_height) = if cfg!(target_os = "macos") {
        (
            source_width / 8,
            source_height * 15 / 64,
            source_width * 3 / 4,
            source_height * 37 / 64,
        )
    } else {
        (0, 0, source_width, source_height)
    };
    let height = 32usize;
    let width = (height * crop_width / crop_height.max(1)).max(1);
    let mut rgba = vec![0; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let mut sums = [0u64; 4];
            let mut samples = 0;
            for sy in top + y * crop_height / height..top + (y + 1) * crop_height / height {
                for sx in left + x * crop_width / width..left + (x + 1) * crop_width / width {
                    let index = (sy * source.width() as usize + sx) * 4;
                    for (channel, sum) in sums.iter_mut().enumerate() {
                        *sum += source.rgba()[index + channel] as u64;
                    }
                    samples += 1;
                }
            }
            let at = (y * width + x) * 4;
            for channel in 0..4 {
                rgba[at + channel] = (sums[channel] / samples.max(1)) as u8;
            }
            if cfg!(target_os = "macos") {
                rgba[at + 3] = ((rgba[at] as u16 * rgba[at + 3] as u16) / 255) as u8;
                rgba[at..at + 3].fill(0);
            }
        }
    }
    Image::new_owned(rgba, width as u32, height as u32)
}

#[cfg(not(target_os = "linux"))]
pub fn toggle_popup(app: &tauri::AppHandle, rect: tauri::Rect) -> Result<(), String> {
    let popup = app
        .get_webview_window("tray")
        .ok_or("Transfer popup is unavailable")?;
    if popup.is_visible().map_err(|e| e.to_string())? {
        return dismiss_tray(app.clone());
    }
    let scale = popup.scale_factor().map_err(|e| e.to_string())?;
    let anchor = rect.position.to_physical::<f64>(scale);
    let monitor = popup
        .monitor_from_point(anchor.x, anchor.y)
        .map_err(|e| e.to_string())?
        .or(popup.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("No display available")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = (POPUP_WIDTH * scale).min(area.size.width as f64);
    let height = (POPUP_HEIGHT * scale).min(area.size.height as f64);
    let size = rect.size.to_physical::<f64>(scale);
    let (x, y) = popup_position(
        (anchor.x, anchor.y, size.width, size.height),
        (
            area.position.x as f64,
            area.position.y as f64,
            area.size.width as f64,
            area.size.height as f64,
        ),
        (width, height),
    );
    popup
        .set_size(tauri::PhysicalSize::new(width as u32, height as u32))
        .map_err(|e| e.to_string())?;
    popup
        .set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| e.to_string())?;
    popup.show().map_err(|e| e.to_string())?;
    popup.set_focus().map_err(|e| e.to_string())
}

#[cfg(any(test, not(target_os = "linux")))]
fn popup_position(
    anchor: (f64, f64, f64, f64),
    area: (f64, f64, f64, f64),
    size: (f64, f64),
) -> (f64, f64) {
    let (ax, ay, aw, ah) = anchor;
    let (x, y, w, h) = area;
    let below = ay + ah + 4.0;
    let py = if below + size.1 <= y + h {
        below
    } else {
        ay - size.1 - 4.0
    };
    (
        (ax + aw / 2.0 - size.0 / 2.0).clamp(x, x + (w - size.0).max(0.0)),
        py.clamp(y, y + (h - size.1).max(0.0)),
    )
}

#[tauri::command]
pub fn dismiss_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(popup) = app.get_webview_window("tray") {
        popup.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_downloads(app: tauri::AppHandle, task_id: Option<String>) -> Result<(), String> {
    *app.state::<TrayState>().navigation.lock().unwrap() = Some(task_id.unwrap_or_default());
    dismiss_tray(app.clone())?;
    crate::windows::present_main_window(&app)?;
    app.emit_to("main", "open-downloads", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn take_download_navigation(app: tauri::AppHandle) -> Option<String> {
    app.state::<TrayState>().navigation.lock().unwrap().take()
}

#[tauri::command]
pub fn quit_from_tray(app: tauri::AppHandle) -> Result<(), String> {
    dismiss_tray(app.clone())?;
    crate::windows::present_main_window(&app)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn tray_snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    crate::task_monitor::snapshot(&app)
        .await
        .map(|value| value["summary"].clone())
}

pub fn update_status(app: &tauri::AppHandle, snapshot: Option<&Value>) {
    let label = match snapshot {
        Some(value) => {
            let running = value["summary"]["running"].as_u64().unwrap_or(0);
            let queued = value["summary"]["queued"].as_u64().unwrap_or(0);
            if running == 0 && queued == 0 {
                "No active transfers".into()
            } else {
                let mut label = format!("{running} downloading / {queued} queued");
                if let Some(speed) = value["summary"]["speedBytes"]
                    .as_f64()
                    .filter(|speed| speed.is_finite() && *speed >= 0.0)
                {
                    label.push_str(&format!(" / {:.1} MB/s", speed / 1_048_576.0));
                }
                label
            }
        }
        None => "Transfer status unavailable".into(),
    };
    let state = app.state::<TrayState>();
    let mut slot = state.ui.lock().unwrap();
    if let Some(ui) = slot.as_mut() {
        if ui.last_label != label {
            let _ = ui.summary.set_text(&label);
            let _ = ui.icon.set_tooltip(Some(format!("Visuales - {label}")));
            ui.last_label = label;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tray_mark_fills_the_template_without_clipping() {
        let mut pixels = vec![0; 64 * 64 * 4];
        for y in 18..50 {
            for x in 11..53 {
                pixels[(y * 64 + x) * 4..(y * 64 + x + 1) * 4].fill(255);
            }
        }
        let icon = small_icon(&Image::new_owned(pixels, 64, 64));
        let visible_rows = icon
            .rgba()
            .chunks_exact(icon.width() as usize * 4)
            .filter(|row| row.chunks_exact(4).any(|pixel| pixel[3] > 128))
            .count();
        assert_eq!(icon.height(), 32);
        if cfg!(target_os = "macos") {
            assert!(icon.width() > 32);
            assert!(
                (26..32).contains(&visible_rows),
                "mark needs most of the icon height, with padding"
            );
        } else {
            assert_eq!(icon.width(), 32);
            assert_eq!(visible_rows, 16);
        }
    }
    #[test]
    fn popup_stays_in_work_area_on_top_bottom_and_negative_displays() {
        assert_eq!(
            popup_position(
                (1000.0, 0.0, 20.0, 24.0),
                (0.0, 24.0, 1200.0, 776.0),
                (360.0, 560.0)
            ),
            (830.0, 28.0)
        );
        assert_eq!(
            popup_position(
                (1180.0, 780.0, 20.0, 20.0),
                (0.0, 0.0, 1200.0, 780.0),
                (360.0, 560.0)
            ),
            (840.0, 216.0)
        );
        assert_eq!(
            popup_position(
                (-1900.0, 0.0, 20.0, 24.0),
                (-1920.0, 24.0, 1920.0, 1000.0),
                (360.0, 560.0)
            ),
            (-1920.0, 28.0)
        );
    }
}
