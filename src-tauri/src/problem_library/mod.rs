mod db;
#[cfg(desktop)]
mod local_directory;
mod package;
mod query;
#[cfg(desktop)]
mod zip_package;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

use db::{ImportSummary, LibraryInfo, LibraryStatus};
use query::{ArchiveInfo, ProblemDetail, ProblemPage, ProblemQuery, TagGroup};

type Result<T> = std::result::Result<T, LibraryError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryError {
    code: &'static str,
    message: String,
}

impl LibraryError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_package", message)
    }
}

impl From<rusqlite::Error> for LibraryError {
    fn from(error: rusqlite::Error) -> Self {
        log::error!("Problem library SQLite operation failed: {error}");
        Self::new("database", "The problem library database operation failed")
    }
}

async fn run<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(&Path) -> Result<T> + Send + 'static,
) -> Result<T> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| LibraryError::new("storage", error.to_string()))?
        .join(db::DATABASE_FILE);
    tauri::async_runtime::spawn_blocking(move || operation(&path))
        .await
        .map_err(|error| LibraryError::new("worker", error.to_string()))?
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImportSource {
    Directory,
    Zip,
}

#[cfg(desktop)]
fn pick_source(
    window: &tauri::WebviewWindow,
    source: ImportSource,
    title: String,
) -> Result<Option<PathBuf>> {
    let dialog = window.dialog().file().set_parent(window).set_title(title);
    let picked = match source {
        ImportSource::Directory => dialog
            .set_can_create_directories(false)
            .blocking_pick_folder(),
        ImportSource::Zip => dialog.add_filter("ZIP", &["zip"]).blocking_pick_file(),
    };
    picked
        .map(|picked| {
            picked.into_path().map_err(|error| {
                let code = match source {
                    ImportSource::Directory => "invalid_directory",
                    ImportSource::Zip => "invalid_zip",
                };
                LibraryError::new(code, error.to_string())
            })
        })
        .transpose()
}

#[cfg(desktop)]
fn install_from_path(
    database: &Path,
    path: &Path,
    source: ImportSource,
) -> Result<Vec<ImportSummary>> {
    let packages = match source {
        ImportSource::Directory => local_directory::read_directory(path)?,
        ImportSource::Zip => zip_package::read_zip(path)?,
    };
    db::install_batch(&mut db::open(database)?, packages)
}

#[cfg(desktop)]
fn infer_import_source(path: &Path) -> Result<ImportSource> {
    if !path.is_absolute() {
        return Err(LibraryError::new(
            "invalid_import_source",
            "An absolute package path is required",
        ));
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        LibraryError::new(
            "invalid_import_source",
            format!("Could not read the selected package path ({error})"),
        )
    })?;
    if metadata.is_dir() {
        return Ok(ImportSource::Directory);
    }
    if metadata.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Ok(ImportSource::Zip);
    }
    Err(LibraryError::new(
        "invalid_import_source",
        "Select a package directory or a ZIP file",
    ))
}

#[tauri::command]
pub(crate) async fn pick_problem_library_source(
    window: tauri::WebviewWindow,
    source: ImportSource,
    title: String,
) -> Result<Option<PathBuf>> {
    #[cfg(desktop)]
    {
        tauri::async_runtime::spawn_blocking(move || pick_source(&window, source, title))
            .await
            .map_err(|error| LibraryError::new("worker", error.to_string()))?
    }
    #[cfg(not(desktop))]
    {
        let _ = (window, source, title);
        Err(LibraryError::new(
            "native_picker_unavailable",
            "The native package picker is available on desktop",
        ))
    }
}

#[tauri::command]
pub(crate) async fn import_problem_libraries_from_path(
    app: AppHandle,
    path: PathBuf,
) -> Result<Vec<ImportSummary>> {
    #[cfg(desktop)]
    {
        run(app, move |database| {
            install_from_path(database, &path, infer_import_source(&path)?)
        })
        .await
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path);
        Err(LibraryError::new(
            "native_picker_unavailable",
            "Importing by native path is available on desktop",
        ))
    }
}

#[tauri::command]
pub(crate) async fn list_problem_libraries(app: AppHandle) -> Result<Vec<LibraryInfo>> {
    run(app, |path| db::list_libraries(&db::open(path)?)).await
}

#[tauri::command]
pub(crate) async fn set_problem_library_enabled(
    app: AppHandle,
    library_id: String,
    enabled: bool,
) -> Result<LibraryInfo> {
    let status = if enabled {
        LibraryStatus::Enabled
    } else {
        LibraryStatus::Disabled
    };
    run(app, move |path| {
        db::set_library_status(&mut db::open(path)?, &library_id, status)
    })
    .await
}

#[tauri::command]
pub(crate) async fn uninstall_problem_library(
    app: AppHandle,
    library_id: String,
) -> Result<LibraryInfo> {
    run(app, move |path| {
        db::set_library_status(
            &mut db::open(path)?,
            &library_id,
            LibraryStatus::Uninstalled,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_library_problems(
    app: AppHandle,
    query: ProblemQuery,
) -> Result<ProblemPage> {
    run(app, move |path| {
        query::list_problems(&db::open(path)?, query)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_library_problem(
    app: AppHandle,
    id: String,
    content_version: Option<i64>,
) -> Result<ProblemDetail> {
    run(app, move |path| {
        query::get_problem(&db::open(path)?, &id, content_version)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_library_archive_children(
    app: AppHandle,
    library_id: String,
    parent_id: Option<String>,
) -> Result<Vec<ArchiveInfo>> {
    run(app, move |path| {
        query::archive_children(&db::open(path)?, &library_id, parent_id.as_deref())
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_library_tag_groups(
    app: AppHandle,
    library_id: Option<String>,
) -> Result<Vec<TagGroup>> {
    run(app, move |path| {
        query::tag_groups(&db::open(path)?, library_id.as_deref())
    })
    .await
}
