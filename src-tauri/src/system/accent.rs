use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct AccentColorPayload {
    pub color: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_theme_get_accent_color() -> Result<Option<String>, String> {
    Ok(read_system_accent_color())
}

pub fn start_accent_color_watch(app: &AppHandle) -> Result<(), String> {
    let initial = read_system_accent_color();
    if let Some(color) = initial.clone() {
        broadcast_accent_color(app, color);
    }

    #[cfg(target_os = "macos")]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let mut last = initial;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                let next = read_system_accent_color();
                if next != last {
                    if let Some(color) = next.clone() {
                        broadcast_accent_color(&app_handle, color);
                    }
                    last = next;
                }
            }
        });
    }

    Ok(())
}

fn broadcast_accent_color(app: &AppHandle, color: String) {
    let _ = app.emit("system-accent-color-changed", AccentColorPayload { color });
}

fn read_system_accent_color() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        return read_macos_accent_color();
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn read_macos_accent_color() -> Option<String> {
    use objc2_app_kit::NSColor;

    let color = NSColor::controlAccentColor();
    let rgb = color.colorUsingColorSpace(&objc2_app_kit::NSColorSpace::sRGBColorSpace())?;
    let mut red = 0.0f64;
    let mut green = 0.0f64;
    let mut blue = 0.0f64;
    let mut alpha = 0.0f64;
    unsafe {
        rgb.getRed_green_blue_alpha(
            &mut red as *mut f64,
            &mut green as *mut f64,
            &mut blue as *mut f64,
            &mut alpha as *mut f64,
        );
    }

    Some(format!(
        "#{:02X}{:02X}{:02X}",
        (red * 255.0).round() as u8,
        (green * 255.0).round() as u8,
        (blue * 255.0).round() as u8
    ))
}
