use std::io;

use serde::{Deserialize, Serialize};
use tauri::{App, AppHandle, Emitter, Manager, State};

use crate::{logging, storage::Storage};

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_CHANGED: &str = "oi-table:settings-changed";
pub const DEFAULT_LOG_MAX_SIZE_MIB: u32 = 5;
const LOG_SIZE_RANGE: std::ops::RangeInclusive<u32> = 1..=100;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    theme: Theme,
    log_max_size_mib: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            log_max_size_mib: DEFAULT_LOG_MAX_SIZE_MIB,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SettingsChanges {
    theme: Option<Theme>,
    log_max_size_mib: Option<u32>,
}

fn load_settings(storage: &Storage) -> io::Result<Option<Settings>> {
    let mut saved: Option<Settings> = storage.read(SETTINGS_FILE)?;
    if let Some(settings) = saved.as_mut() {
        if !LOG_SIZE_RANGE.contains(&settings.log_max_size_mib) {
            settings.log_max_size_mib = DEFAULT_LOG_MAX_SIZE_MIB;
        }
    }
    Ok(saved)
}

pub fn startup_log_limit(app: &App) -> io::Result<u32> {
    let storage = app.state::<Storage>();
    Ok(load_settings(&storage)?
        .unwrap_or_default()
        .log_max_size_mib)
}

fn read_settings(
    storage: &Storage,
    legacy_theme: Option<Theme>,
    notify: impl FnOnce(),
) -> io::Result<Settings> {
    let Some(theme) = legacy_theme else {
        return Ok(load_settings(storage)?.unwrap_or_default());
    };

    storage.with_write_lock(|| {
        if let Some(saved) = load_settings(storage)? {
            return Ok(saved);
        }

        let settings = Settings {
            theme,
            ..Settings::default()
        };
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
    if changes
        .log_max_size_mib
        .is_some_and(|size| !LOG_SIZE_RANGE.contains(&size))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Log limit must be 1–100 MiB",
        ));
    }
    storage.with_write_lock(|| {
        let mut settings = load_settings(storage)?.unwrap_or_default();
        if let Some(theme) = changes.theme {
            settings.theme = theme;
        }
        if let Some(size) = changes.log_max_size_mib {
            settings.log_max_size_mib = size;
        }
        storage.write(SETTINGS_FILE, &settings)?;
        notify();
        Ok(())
    })
}

fn notify_settings_changed(app: &AppHandle) {
    if let Err(error) = app.emit(SETTINGS_CHANGED, ()) {
        log::warn!("Could not notify settings listeners: {error}");
    }
}

#[tauri::command]
pub async fn get_settings(
    app: AppHandle,
    storage: State<'_, Storage>,
    legacy_theme: Option<Theme>,
) -> Result<Settings, String> {
    read_settings(&storage, legacy_theme, || notify_settings_changed(&app)).map_err(|error| {
        log::warn!("Could not read settings ({:?})", error.kind());
        error.to_string()
    })
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    storage: State<'_, Storage>,
    changes: SettingsChanges,
) -> Result<(), String> {
    let log_limit = changes.log_max_size_mib;
    save_settings(&storage, changes, || {
        if let Some(size) = log_limit {
            if let Err(error) = logging::set_max_size_mib(size) {
                log::warn!("Could not apply the log size limit ({:?})", error.kind());
            }
        }
        notify_settings_changed(&app);
        log::info!("Settings saved");
    })
    .map_err(|error| {
        log::warn!("Could not save settings ({:?})", error.kind());
        error.to_string()
    })
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
                log_max_size_mib: None,
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

    #[test]
    fn old_settings_use_default_log_limit_and_invalid_changes_leave_the_file_unchanged(
    ) -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let storage = Storage::new(directory.path().to_owned());
        storage.write(SETTINGS_FILE, &serde_json::json!({ "theme": "dark" }))?;
        assert_eq!(load_settings(&storage)?.unwrap().log_max_size_mib, 5);

        save_settings(
            &storage,
            SettingsChanges {
                theme: None,
                log_max_size_mib: Some(12),
            },
            || {},
        )?;
        let invalid = save_settings(
            &storage,
            SettingsChanges {
                theme: None,
                log_max_size_mib: Some(0),
            },
            || unreachable!(),
        );
        assert_eq!(invalid.unwrap_err().kind(), io::ErrorKind::InvalidInput);
        let saved = load_settings(&storage)?.unwrap();
        assert_eq!(saved.theme, Theme::Dark);
        assert_eq!(saved.log_max_size_mib, 12);
        Ok(())
    }
}
