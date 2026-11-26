use std::io;

use serde_json::{Map, Value};
use tauri::{App, AppHandle, Emitter, Manager, State};

use crate::{logging, storage::Storage};

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_CHANGED: &str = "oi-table:settings-changed";
const THEME_KEY: &str = "theme";
const LOG_MAX_SIZE_KEY: &str = "logMaxSizeMib";
const EDITOR_DEFAULT_LANGUAGE_KEY: &str = "editorDefaultLanguage";
const PROBLEM_DOUBLE_COLUMN_KEY: &str = "problemDoubleColumn";
const FONT_PRESETS: &[&str] = &["system", "yahei", "serif", "monospace", "fira-code"];
pub const DEFAULT_LOG_MAX_SIZE_MIB: u32 = 5;

type Settings = Map<String, Value>;

enum Rule {
    Choice {
        default: &'static str,
        alternatives: &'static [&'static [&'static str]],
    },
    Integer {
        default: u32,
        min: u64,
        max: u64,
    },
    Boolean {
        default: bool,
    },
}

const RULES: &[(&str, Rule)] = &[
    (
        THEME_KEY,
        Rule::Choice {
            default: "system",
            alternatives: &[&["light", "dark", "mint"]],
        },
    ),
    (
        "uiLanguage",
        Rule::Choice {
            default: "system",
            alternatives: &[&["zh-CN", "en"]],
        },
    ),
    (
        "uiFont",
        Rule::Choice {
            default: "system",
            alternatives: &[FONT_PRESETS],
        },
    ),
    (
        "uiFontSize",
        Rule::Integer {
            default: 16,
            min: 12,
            max: 20,
        },
    ),
    (
        "editorFont",
        Rule::Choice {
            default: "fira-code",
            alternatives: &[FONT_PRESETS, &["interface"]],
        },
    ),
    (
        "editorFontSize",
        Rule::Integer {
            default: 13,
            min: 8,
            max: 40,
        },
    ),
    (
        "editorFontSizeMode",
        Rule::Choice {
            default: "custom",
            alternatives: &[&["interface"]],
        },
    ),
    (
        EDITOR_DEFAULT_LANGUAGE_KEY,
        Rule::Choice {
            default: "cpp",
            alternatives: &[&["python"]],
        },
    ),
    (PROBLEM_DOUBLE_COLUMN_KEY, Rule::Boolean { default: false }),
    (
        LOG_MAX_SIZE_KEY,
        Rule::Integer {
            default: DEFAULT_LOG_MAX_SIZE_MIB,
            min: 1,
            max: 100,
        },
    ),
];

fn normalize(mut settings: Settings) -> Settings {
    for (key, rule) in RULES {
        let current = settings.get(*key);
        let fallback = match rule {
            Rule::Choice {
                default,
                alternatives,
            } => {
                let valid = current.and_then(Value::as_str).is_some_and(|value| {
                    value == *default || alternatives.iter().any(|options| options.contains(&value))
                });
                (!valid).then(|| Value::from(*default))
            }
            Rule::Integer { default, min, max } => {
                let valid = current
                    .and_then(Value::as_u64)
                    .is_some_and(|value| (*min..=*max).contains(&value));
                (!valid).then(|| Value::from(*default))
            }
            Rule::Boolean { default } => current
                .and_then(Value::as_bool)
                .is_none()
                .then(|| Value::from(*default)),
        };
        if let Some(fallback) = fallback {
            settings.insert((*key).to_owned(), fallback);
        }
    }
    settings
}

fn log_max_size(settings: &Settings) -> u32 {
    settings
        .get(LOG_MAX_SIZE_KEY)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(DEFAULT_LOG_MAX_SIZE_MIB)
}

pub fn startup_log_limit(app: &App) -> io::Result<u32> {
    let storage = app.state::<Storage>();
    Ok(log_max_size(&read_settings(&storage, None, || {})?))
}

fn read_settings(
    storage: &Storage,
    legacy_theme: Option<String>,
    notify: impl FnOnce(),
) -> io::Result<Settings> {
    let Some(theme) = legacy_theme else {
        return Ok(normalize(storage.read(SETTINGS_FILE)?.unwrap_or_default()));
    };

    storage.with_write_lock(|| {
        if let Some(saved) = storage.read(SETTINGS_FILE)? {
            return Ok(normalize(saved));
        }

        let settings = normalize(Settings::from_iter([(
            THEME_KEY.to_owned(),
            Value::from(theme),
        )]));
        storage.write(SETTINGS_FILE, &settings)?;
        notify();
        Ok(settings)
    })
}

fn save_settings(
    storage: &Storage,
    changes: Settings,
    notify: impl FnOnce(Option<u32>),
) -> io::Result<()> {
    let log_limit_changed = changes.contains_key(LOG_MAX_SIZE_KEY);
    storage.with_write_lock(|| {
        let mut settings = storage.read::<Settings>(SETTINGS_FILE)?.unwrap_or_default();
        settings.extend(changes);
        let settings = normalize(settings);
        storage.write(SETTINGS_FILE, &settings)?;
        notify(log_limit_changed.then(|| log_max_size(&settings)));
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
    legacy_theme: Option<String>,
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
    changes: Settings,
) -> Result<(), String> {
    save_settings(&storage, changes, |log_limit| {
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
    use serde_json::json;

    #[test]
    fn defaults_migration_and_partial_updates_share_one_settings_file() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let storage = Storage::new(directory.path().to_owned());
        assert_eq!(
            read_settings(&storage, None, || unreachable!())?[THEME_KEY],
            "system"
        );
        assert_eq!(
            read_settings(&storage, Some("dark".into()), || {})?[THEME_KEY],
            "dark"
        );

        save_settings(
            &storage,
            serde_json::from_value(json!({
                "uiLanguage": "zh-CN",
                "uiFont": "monospace",
                "editorFont": "monospace",
                "editorDefaultLanguage": "python",
                "problemDoubleColumn": true,
                "editorPrefs": { "wordWrap": true, "extra": null },
            }))?,
            |log_limit| assert_eq!(log_limit, None),
        )?;
        save_settings(
            &storage,
            serde_json::from_value(json!({ "theme": "mint", "uiFontSize": 18 }))?,
            |log_limit| assert_eq!(log_limit, None),
        )?;

        let reopened = Storage::new(directory.path().to_owned());
        let settings = read_settings(&reopened, Some("dark".into()), || unreachable!())?;
        assert_eq!(settings[THEME_KEY], "mint");
        assert_eq!(settings["uiLanguage"], "zh-CN");
        assert_eq!(settings["uiFont"], "monospace");
        assert_eq!(settings["editorFont"], "monospace");
        assert_eq!(settings["uiFontSize"], 18);
        assert_eq!(settings[EDITOR_DEFAULT_LANGUAGE_KEY], "python");
        assert_eq!(settings[PROBLEM_DOUBLE_COLUMN_KEY], true);
        assert_eq!(
            settings["editorPrefs"],
            json!({ "wordWrap": true, "extra": null })
        );
        Ok(())
    }

    #[test]
    fn invalid_and_missing_values_use_the_rules_defaults() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let storage = Storage::new(directory.path().to_owned());
        storage.write(
            SETTINGS_FILE,
            &json!({
                "theme": "dark",
                "uiLanguage": false,
                "uiFont": "interface",
                "uiFontSize": 17.5,
                "logMaxSizeMib": -1,
            }),
        )?;
        let loaded = read_settings(&storage, None, || unreachable!())?;
        assert_eq!(loaded[THEME_KEY], "dark");
        assert_eq!(loaded["uiLanguage"], "system");
        assert_eq!(loaded["uiFont"], "system");
        assert_eq!(loaded["uiFontSize"], 16);
        assert_eq!(loaded["editorFont"], "fira-code");
        assert_eq!(loaded["editorFontSize"], 13);
        assert_eq!(loaded["editorFontSizeMode"], "custom");
        assert_eq!(loaded[EDITOR_DEFAULT_LANGUAGE_KEY], "cpp");
        assert_eq!(loaded[PROBLEM_DOUBLE_COLUMN_KEY], false);
        assert_eq!(log_max_size(&loaded), DEFAULT_LOG_MAX_SIZE_MIB);

        save_settings(
            &storage,
            serde_json::from_value(json!({
                "uiLanguage": "en",
                "uiFont": "fira-code",
                "uiFontSize": 20,
                "editorFont": "interface",
                "editorFontSize": 40,
                "editorFontSizeMode": "interface",
                "editorDefaultLanguage": "python",
                "logMaxSizeMib": 12,
            }))?,
            |log_limit| assert_eq!(log_limit, Some(12)),
        )?;
        let followed = read_settings(&storage, None, || unreachable!())?;
        assert_eq!(followed["uiFont"], "fira-code");
        assert_eq!(followed["editorFont"], "interface");
        assert_eq!(followed["editorFontSize"], 40);
        assert_eq!(followed["editorFontSizeMode"], "interface");
        assert_eq!(followed[EDITOR_DEFAULT_LANGUAGE_KEY], "python");

        save_settings(
            &storage,
            serde_json::from_value(json!({
                "uiFontSize": 21,
                "editorFont": "invalid-preset",
                "editorFontSize": 41,
                "editorFontSizeMode": false,
                "editorDefaultLanguage": "javascript",
                "problemDoubleColumn": "true",
                "logMaxSizeMib": "12",
            }))?,
            |log_limit| assert_eq!(log_limit, Some(DEFAULT_LOG_MAX_SIZE_MIB)),
        )?;

        let saved = storage.read::<Settings>(SETTINGS_FILE)?.unwrap();
        assert_eq!(saved[THEME_KEY], "dark");
        assert_eq!(saved["uiLanguage"], "en");
        assert_eq!(saved["uiFont"], "fira-code");
        assert_eq!(saved["uiFontSize"], 16);
        assert_eq!(saved["editorFont"], "fira-code");
        assert_eq!(saved["editorFontSize"], 13);
        assert_eq!(saved["editorFontSizeMode"], "custom");
        assert_eq!(saved[EDITOR_DEFAULT_LANGUAGE_KEY], "cpp");
        assert_eq!(saved[PROBLEM_DOUBLE_COLUMN_KEY], false);
        assert_eq!(saved[LOG_MAX_SIZE_KEY], DEFAULT_LOG_MAX_SIZE_MIB);
        Ok(())
    }
}
