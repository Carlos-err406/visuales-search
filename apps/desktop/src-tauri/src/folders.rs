use std::path::PathBuf;

fn output_directory(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    let path = if let Some(suffix) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        dirs::home_dir()
            .ok_or("Could not determine your home directory")?
            .join(suffix)
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() {
        return Err("Enter an absolute output folder path".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("Output folder does not exist yet: {}", path.display())
        } else {
            format!("Cannot access output folder: {error}")
        }
    })?;
    if !metadata.is_dir() {
        return Err("The output path is not a folder".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn open_output_folder(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Only existing directories reach the opener, never files, URLs or shell commands.
        let folder = output_directory(&path)?;
        tauri_plugin_opener::open_path(folder, None::<&str>).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_output_folders_without_creating_them() {
        let root = std::env::temp_dir().join(format!("visuales-folders-{}", std::process::id()));
        let folder = root.join("A folder with spaces (2026)");
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(output_directory(folder.to_str().unwrap()).unwrap(), folder);
        let file = root.join("not-a-folder.txt");
        std::fs::write(&file, b"test").unwrap();
        assert!(output_directory(file.to_str().unwrap())
            .unwrap_err()
            .contains("not a folder"));
        let missing = root.join("missing");
        assert!(output_directory(missing.to_str().unwrap())
            .unwrap_err()
            .contains("does not exist"));
        assert!(!missing.exists());
        for invalid in [
            "",
            "relative/path",
            "https://example.com",
            "file:///tmp",
            "--help",
        ] {
            assert!(output_directory(invalid).is_err());
        }
        if let Some(home) = dirs::home_dir() {
            assert_eq!(output_directory("~/").unwrap(), home);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
