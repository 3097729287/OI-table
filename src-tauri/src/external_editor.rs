use std::{
    collections::HashMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
};

use tauri::{AppHandle, Manager};

#[cfg(any(windows, target_os = "macos"))]
use std::env;

use crate::{
    editor_run::{find_program, hidden_command, EditorLanguage},
    problem_drafts::MAX_DRAFT_BYTES,
};

#[derive(Default)]
pub(crate) struct ExternalEditors(Mutex<HashMap<String, ExternalFile>>);

struct ExternalFile {
    directory: tempfile::TempDir,
    path: PathBuf,
    source: String,
}

impl ExternalFile {
    fn new(language: EditorLanguage, source: String) -> io::Result<Self> {
        let directory = tempfile::Builder::new().prefix("oi-table-").tempdir()?;
        let path = directory.path().join(match language {
            EditorLanguage::Cpp => "solution.cpp",
            EditorLanguage::Python => "solution.py",
        });
        fs::write(&path, &source)?;
        Ok(Self {
            directory,
            path,
            source,
        })
    }

    fn read_update(&mut self) -> io::Result<Option<String>> {
        if !fs::symlink_metadata(&self.path)?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Expected a regular file",
            ));
        }
        let mut file = fs::File::open(&self.path)?;
        let before = file.metadata()?;
        // Allow for a UTF-8 BOM and CRLF before checking the normalized draft size.
        let mut bytes = Vec::new();
        file.by_ref()
            .take((2 * MAX_DRAFT_BYTES + 4) as u64)
            .read_to_end(&mut bytes)?;
        let after = file.metadata()?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "Editor save in progress",
            ));
        }
        if bytes == self.source.as_bytes() {
            return Ok(None);
        }
        let text = std::str::from_utf8(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let source = if text.contains('\r') {
            text.replace("\r\n", "\n").replace('\r', "\n")
        } else {
            text.to_owned()
        };
        if source.len() > MAX_DRAFT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Draft exceeds 1 MiB",
            ));
        }
        if self.source == source {
            return Ok(None);
        }
        self.source.clone_from(&source);
        Ok(Some(source))
    }
}

impl ExternalEditors {
    pub(crate) fn close_all(&self) {
        for (_, mut file) in self.0.lock().expect("external editors lock").drain() {
            // A file still open at app exit may contain a save newer than the last read.
            file.directory.disable_cleanup(true);
        }
    }
}

#[cfg(windows)]
fn find_vscode() -> Option<PathBuf> {
    find_program("Code")
        .or_else(|| {
            let paths = env::var_os("PATH")?;
            env::split_paths(&paths)
                .filter(|directory| directory.is_absolute() && directory.join("code.cmd").is_file())
                .filter_map(|directory| Some(directory.parent()?.join("Code.exe")))
                .find(|path| path.is_file())
        })
        .or_else(|| {
            [
                ("LOCALAPPDATA", "Programs/Microsoft VS Code/Code.exe"),
                ("ProgramFiles", "Microsoft VS Code/Code.exe"),
                ("ProgramFiles(x86)", "Microsoft VS Code/Code.exe"),
            ]
            .into_iter()
            .filter_map(|(root, relative)| Some(PathBuf::from(env::var_os(root)?).join(relative)))
            .find(|path| path.is_absolute() && path.is_file())
        })
}

#[cfg(not(windows))]
fn find_vscode() -> Option<PathBuf> {
    let program = find_program("code");
    #[cfg(target_os = "macos")]
    let program = program.or_else(|| {
        let cli = "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
        [
            Some(PathBuf::from("/")),
            env::var_os("HOME").map(PathBuf::from),
        ]
        .into_iter()
        .flatten()
        .map(|root| root.join(cli))
        .find(|path| path.is_file())
    });
    program
}

fn launch_vscode(program: &Path, path: &Path) -> io::Result<()> {
    let child = hidden_command(program)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    #[cfg(unix)]
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
    #[cfg(not(unix))]
    drop(child);
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_external_editor(
    app: AppHandle,
    language: EditorLanguage,
    source: String,
) -> Result<String, &'static str> {
    if !cfg!(desktop) {
        return Err("external_editor_unavailable");
    }
    if source.len() > MAX_DRAFT_BYTES {
        return Err("external_editor_source_too_large");
    }
    tauri::async_runtime::spawn_blocking(move || {
        let program = find_vscode().ok_or("external_editor_vscode_missing")?;
        let file = ExternalFile::new(language, source).map_err(|error| {
            log::warn!(
                "Could not create an external editor draft: {:?}",
                error.kind()
            );
            "external_editor_open_failed"
        })?;
        launch_vscode(&program, &file.path).map_err(|error| {
            log::warn!("Could not launch VS Code: {:?}", error.kind());
            "external_editor_open_failed"
        })?;
        let id = file
            .directory
            .path()
            .file_name()
            .ok_or("external_editor_open_failed")?
            .to_string_lossy()
            .into_owned();
        app.state::<ExternalEditors>()
            .0
            .lock()
            .expect("external editors lock")
            .insert(id.clone(), file);
        Ok(id)
    })
    .await
    .map_err(|_| "external_editor_open_failed")?
}

#[tauri::command]
pub(crate) async fn read_external_editor(
    app: AppHandle,
    session_id: String,
    finish: bool,
) -> Result<Option<String>, &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExternalEditors>();
        let mut files = state.0.lock().expect("external editors lock");
        let file = files
            .get_mut(&session_id)
            .ok_or("external_editor_sync_failed")?;
        let update = file.read_update();
        // Leave a saved external draft available in VS Code when we could not import it.
        file.directory.disable_cleanup(update.is_err());
        if finish {
            files.remove(&session_id);
        }
        update.map_err(|_| "external_editor_sync_failed")
    })
    .await
    .map_err(|_| "external_editor_sync_failed")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_replacement_files_and_normalizes_editor_line_endings() -> io::Result<()> {
        let mut file = ExternalFile::new(EditorLanguage::Cpp, "// initial\n".into())?;
        assert_eq!(file.path.extension().unwrap(), "cpp");
        assert_eq!(file.read_update()?, None);
        let mut replacement = tempfile::NamedTempFile::new_in(file.directory.path())?;
        io::Write::write_all(&mut replacement, "\u{feff}// 新しい 😀\r\n\r\n".as_bytes())?;
        replacement.persist(&file.path)?;
        assert_eq!(file.read_update()?.as_deref(), Some("// 新しい 😀\n\n"));
        assert_eq!(file.read_update()?, None);
        fs::write(&file.path, "")?;
        assert_eq!(file.read_update()?.as_deref(), Some(""));
        let path = file.path.clone();
        drop(file);
        assert!(!path.exists());
        Ok(())
    }

    #[test]
    fn preserves_the_last_valid_source_until_a_read_recovers() -> io::Result<()> {
        let mut file = ExternalFile::new(EditorLanguage::Python, "pass\n".into())?;
        assert_eq!(file.path.extension().unwrap(), "py");
        fs::write(&file.path, [0xff, 0xff])?;
        assert_eq!(
            file.read_update().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        fs::write(&file.path, vec![b'x'; MAX_DRAFT_BYTES + 1])?;
        assert_eq!(
            file.read_update().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(file.source, "pass\n");
        fs::write(&file.path, "print('recovered')\n")?;
        assert_eq!(file.read_update()?.as_deref(), Some("print('recovered')\n"));
        Ok(())
    }
}
