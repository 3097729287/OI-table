use std::io;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::storage::Storage;

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_CHANGED: &str = "oi-table:settings-changed";

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct Settings {
    theme: Theme,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsChanges {
    theme: Option<Theme>,
}

fn read_settings(
    storage: &Storage,
    legacy_theme: Option<Theme>,
    notify: impl FnOnce(),
) -> io::Result<Settings> {
    let Some(theme) = legacy_theme else {
        return Ok(storage.read(SETTINGS_FILE)?.unwrap_or_default());
    };

    storage.with_write_lock(|| {
        if let Some(saved) = storage.read(SETTINGS_FILE)? {
            return Ok(saved);
        }

        let settings = Settings { theme };
        storage.write(SETTINGS_FILE, &settings)?;
        notify();
        Ok(settings)
    })
}

fn save_settings(
    storage: &Storage,
    changes: SettingsChanges,
    notify: impl FnOnce(),
) -> io::Result<()> {
    storage.with_write_lock(|| {
        let mut settings: Settings = storage.read(SETTINGS_FILE)?.unwrap_or_default();
        if let Some(theme) = changes.theme {
            settings.theme = theme;
        }
        storage.write(SETTINGS_FILE, &settings)?;
        notify();
        Ok(())
    })
}

fn notify_settings_changed(app: &AppHandle) {
    if let Err(error) = app.emit(SETTINGS_CHANGED, ()) {
        eprintln!("Could not notify settings listeners: {error}");
    }
}

#[tauri::command]
pub async fn get_settings(
    app: AppHandle,
    storage: State<'_, Storage>,
    legacy_theme: Option<Theme>,
) -> Result<Settings, String> {
    read_settings(&storage, legacy_theme, || notify_settings_changed(&app))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    storage: State<'_, Storage>,
    changes: SettingsChanges,
) -> Result<(), String> {
    save_settings(&storage, changes, || notify_settings_changed(&app))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_migration_and_later_saves_share_one_settings_file() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let storage = Storage::new(directory.path().to_owned());
        assert_eq!(
            read_settings(&storage, None, || unreachable!())?.theme,
            Theme::System
        );
        assert_eq!(
            read_settings(&storage, Some(Theme::Dark), || {})?.theme,
            Theme::Dark
        );

        save_settings(
            &storage,
            SettingsChanges {
                theme: Some(Theme::Light),
            },
            || {},
        )?;
        let reopened = Storage::new(directory.path().to_owned());
        assert_eq!(
            read_settings(&reopened, Some(Theme::Dark), || unreachable!())?.theme,
            Theme::Light
        );
        Ok(())
    }
}
