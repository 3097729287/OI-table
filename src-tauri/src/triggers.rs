use std::{collections::HashMap, io};

use tauri::{AppHandle, Emitter, State};

use crate::storage::Storage;

const TRIGGER_FILE: &str = "triggers.json";
const TRIGGER_CHANGED: &str = "oi-table:trigger-changed";
type TriggerCounts = HashMap<String, u32>;

fn get(storage: &Storage, name: &str) -> io::Result<u32> {
    let counts: TriggerCounts = storage.read(TRIGGER_FILE)?.unwrap_or_default();
    Ok(counts.get(name).copied().unwrap_or(0))
}

fn increment(storage: &Storage, name: &str, notify: impl FnOnce(u32)) -> io::Result<u32> {
    storage.with_write_lock(|| {
        let mut counts: TriggerCounts = storage.read(TRIGGER_FILE)?.unwrap_or_default();
        let count = counts.entry(name.to_owned()).or_default();
        *count = count
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Trigger count overflow"))?;
        let next = *count;

        storage.write(TRIGGER_FILE, &counts)?;
        // Notify after saving and before the next increment can publish.
        notify(next);
        Ok(next)
    })
}

#[tauri::command]
pub async fn get_trigger(storage: State<'_, Storage>, name: String) -> Result<u32, String> {
    get(&storage, &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn increment_trigger(
    app: AppHandle,
    storage: State<'_, Storage>,
    name: String,
) -> Result<u32, String> {
    increment(&storage, &name, |count| {
        if let Err(error) = app.emit(TRIGGER_CHANGED, (&name, count)) {
            eprintln!("Could not notify trigger listeners: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn concurrent_increments_are_saved_and_notified_in_order() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let storage = Storage::new(directory.path().to_owned());
        let notifications = Mutex::new(Vec::new());
        assert_eq!(get(&storage, "example")?, 0);

        std::thread::scope(|scope| {
            let run = || {
                increment(&storage, "example", |count| {
                    notifications.lock().unwrap().push(count)
                })
            };
            let first = scope.spawn(run);
            let second = scope.spawn(run);
            first.join().unwrap()?;
            second.join().unwrap()?;
            Ok::<(), io::Error>(())
        })?;

        let reopened = Storage::new(directory.path().to_owned());
        assert_eq!(get(&reopened, "example")?, 2);
        assert_eq!(get(&reopened, "other")?, 0);
        assert_eq!(*notifications.lock().unwrap(), [1, 2]);
        Ok(())
    }
}
