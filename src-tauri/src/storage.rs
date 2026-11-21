use std::{fs, io, path::PathBuf, sync::Mutex};

use serde::{de::DeserializeOwned, Serialize};
use tauri::{App, Manager};

pub struct Storage {
    directory: PathBuf,
    writes: Mutex<()>,
}

impl Storage {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            writes: Mutex::new(()),
        }
    }

    pub fn read<T: DeserializeOwned>(&self, file: &str) -> io::Result<Option<T>> {
        match fs::read(self.directory.join(file)) {
            Ok(contents) => serde_json::from_slice(&contents)
                .map(Some)
                .map_err(io::Error::other),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn with_write_lock<T>(&self, write: impl FnOnce() -> io::Result<T>) -> io::Result<T> {
        let _guard = self
            .writes
            .lock()
            .map_err(|_| io::Error::other("Storage lock is poisoned"))?;
        write()
    }

    pub fn write(&self, file: &str, value: &impl Serialize) -> io::Result<()> {
        fs::create_dir_all(&self.directory)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        serde_json::to_writer(temporary.as_file_mut(), value).map_err(io::Error::other)?;
        temporary.as_file().sync_all()?;
        temporary.persist(self.directory.join(file))?;
        Ok(())
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    app.manage(Storage::new(app.path().app_data_dir()?));
    Ok(())
}
