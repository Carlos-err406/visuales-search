#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
fn app_bundle(binary: &std::path::Path) -> Option<&std::path::Path> {
    use std::ffi::OsStr;
    let macos = binary.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name() == Some(OsStr::new("MacOS"))
        && contents.file_name() == Some(OsStr::new("Contents"))
        && bundle.extension() == Some(OsStr::new("app")))
    .then_some(bundle)
}

pub async fn restart(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Use Tauri's cached, symlink-checked path, not a path supplied by IPC.
        let env = app.env();
        let binary = tauri::process::current_binary(&env).map_err(|error| error.to_string())?;
        if let Some(bundle) = app_bundle(&binary) {
            let bundle = bundle.to_owned();
            let args: Vec<_> = env.args_os.into_iter().skip(1).collect();
            // Launch Services registers and activates the new bundle. Spawning
            // its executable directly can leave a Dock-only background app.
            let status = tauri::async_runtime::spawn_blocking(move || {
                std::process::Command::new("/usr/bin/open")
                    .arg("-n")
                    .arg("-a")
                    .arg(bundle)
                    .arg("--args")
                    .args(args)
                    .status()
            })
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| format!("Could not reopen Visuales: {error}"))?;
            if !status.success() {
                return Err(format!(
                    "macOS could not reopen Visuales ({status}). Try restarting again."
                ));
            }
            app.exit(0);
            return Ok(());
        }
    }
    // Dev executables and other platforms still use Tauri's event-loop restart.
    app.request_restart();
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn recognizes_only_executables_in_app_bundles() {
        for bundle in [
            "/Applications/Visuales.app",
            "/tmp/Folder with spaces/Visuales Test.app",
        ] {
            let binary = format!("{bundle}/Contents/MacOS/visuales-desktop");
            assert_eq!(app_bundle(Path::new(&binary)), Some(Path::new(bundle)));
        }
        for binary in [
            "/tmp/visuales-desktop",
            "/tmp/not-app/Contents/MacOS/app",
            "/tmp/X.app/Other/MacOS/app",
            "/tmp/X.app/Contents/Other/app",
        ] {
            assert_eq!(app_bundle(Path::new(binary)), None);
        }
    }
}
