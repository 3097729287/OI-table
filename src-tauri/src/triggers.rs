use std::{collections::HashMap, fs, io, path::PathBuf, sync::Mutex};
use tauri::{App, AppHandle, Emitter, Manager, State};

const TRIGGER_CHANGED: &str = "oi-table:trigger-changed";

pub struct TriggerStore {
    path: PathBuf,
    updates: Mutex<()>,
}

impl TriggerStore {
    fn read_counts(&self) -> io::Result<HashMap<String, u32>> {
        match fs::read(&self.path) {
            Ok(contents) => serde_json::from_slice(&contents).map_err(io::Error::other),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(error) => Err(error),
        }
    }

    fn get(&self, name: &str) -> io::Result<u32> {
        Ok(self.read_counts()?.get(name).copied().unwrap_or(0))
    }

    fn increment(&self, name: &str, notify: impl FnOnce(u32)) -> io::Result<u32> {
        let _update = self
            .updates
            .lock()
            .map_err(|_| io::Error::other("Trigger store lock is poisoned"))?;
        let mut counts = self.read_counts()?;
        let count = counts.entry(name.to_owned()).or_default();
        *count = count
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Trigger count overflow"))?;
        let next = *count;

        let directory = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("Missing trigger directory"))?;
        fs::create_dir_all(directory)?;
        let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
        serde_json::to_writer(temporary.as_file_mut(), &counts).map_err(io::Error::other)?;
        temporary.as_file().sync_all()?;
        temporary.persist(&self.path)?;

        // Notify after saving and before the next increment can publish.
        notify(next);
        Ok(next)
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    app.manage(TriggerStore {
        path: app.path().app_data_dir()?.join("triggers.json"),
        updates: Mutex::new(()),
    });
    Ok(())
}

#[tauri::command]
pub async fn get_trigger(store: State<'_, TriggerStore>, name: String) -> Result<u32, String> {
    store.get(&name).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn increment_trigger(
    app: AppHandle,
    store: State<'_, TriggerStore>,
    name: String,
) -> Result<u32, String> {
    store
        .increment(&name, |count| {
            if let Err(error) = app.emit(TRIGGER_CHANGED, (&name, count)) {
                eprintln!("Could not notify trigger listeners: {error}");
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_increments_are_saved_and_notified_in_order() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("triggers.json");
        let store = TriggerStore {
            path: path.clone(),
            updates: Mutex::new(()),
        };
        let notifications = Mutex::new(Vec::new());
        assert_eq!(store.get("example")?, 0);

        std::thread::scope(|scope| {
            let increment =
                || store.increment("example", |count| notifications.lock().unwrap().push(count));
            let first = scope.spawn(increment);
            let second = scope.spawn(increment);
            first.join().unwrap()?;
            second.join().unwrap()?;
            Ok::<(), io::Error>(())
        })?;

        let reopened = TriggerStore {
            path,
            updates: Mutex::new(()),
        };
        assert_eq!(reopened.get("example")?, 2);
        assert_eq!(reopened.get("other")?, 0);
        assert_eq!(*notifications.lock().unwrap(), [1, 2]);
        Ok(())
    }
}
