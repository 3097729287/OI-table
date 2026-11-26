use std::{fs, path::Path, time::Duration};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;

use super::{
    package::{LocalizedText, Package, Problem},
    personal, LibraryError, Result,
};

pub(super) const DATABASE_FILE: &str = "problem-library.sqlite3";
const SCHEMA_VERSION: i64 = 1;
const SELECT_LIBRARY: &str = "SELECT l.id, l.name_zh_cn, l.name_en, l.release_version, l.status,
    l.author_id, l.author_name_zh_cn, l.author_name_en,
    (SELECT count(*) FROM problems p WHERE p.library_id = l.id AND p.removed = 0)
    FROM libraries l";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum LibraryStatus {
    Enabled,
    Disabled,
    Uninstalled,
}

impl LibraryStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
            Self::Uninstalled => "uninstalled",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryInfo {
    pub(super) id: String,
    pub(super) name: LocalizedText,
    pub(super) author_id: String,
    pub(super) author_name: Option<LocalizedText>,
    pub(super) release_version: i64,
    pub(super) status: String,
    pub(super) problem_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportSummary {
    pub(super) library: LibraryInfo,
    pub(super) inserted: usize,
    pub(super) updated: usize,
    pub(super) removed: usize,
    pub(super) unchanged: usize,
    pub(super) restored: usize,
    pub(super) replayed: bool,
}

pub(super) fn open(path: &Path) -> Result<Connection> {
    if let Some(directory) = path.parent().filter(|path| !path.as_os_str().is_empty()) {
        fs::create_dir_all(directory).map_err(|error| {
            log::error!("Could not create the problem library directory: {error}");
            LibraryError::new("storage", "Could not create the problem library directory")
        })?;
    }

    let mut connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    if schema_version(&connection)? != SCHEMA_VERSION {
        let migration = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match schema_version(&migration)? {
            0 => {
                migration.execute_batch(include_str!("migrations/001_initial.sql"))?;
                migration.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            }
            SCHEMA_VERSION => (),
            version => {
                return Err(LibraryError::new(
                    "unsupported_database",
                    format!(
                        "Unsupported problem library database version {version}. Expected {SCHEMA_VERSION}."
                    ),
                ))
            }
        }
        migration.commit()?;
    }
    personal::merge_legacy_groups(&mut connection)?;
    Ok(connection)
}

fn schema_version(connection: &Connection) -> Result<i64> {
    Ok(connection.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

fn library_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryInfo> {
    let author_name = LocalizedText {
        zh_cn: row.get(6)?,
        en: row.get(7)?,
    };
    Ok(LibraryInfo {
        id: row.get(0)?,
        name: LocalizedText {
            zh_cn: row.get(1)?,
            en: row.get(2)?,
        },
        author_id: row.get(5)?,
        author_name: (author_name.zh_cn.is_some() || author_name.en.is_some())
            .then_some(author_name),
        release_version: row.get(3)?,
        status: row.get(4)?,
        problem_count: row.get(8)?,
    })
}

pub(super) fn list_libraries(connection: &Connection) -> Result<Vec<LibraryInfo>> {
    let mut query = connection.prepare(&format!("{SELECT_LIBRARY} ORDER BY l.id"))?;
    let libraries = query
        .query_map([], library_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(libraries)
}

fn get_library(connection: &Connection, id: &str) -> Result<LibraryInfo> {
    connection
        .query_row(
            &format!("{SELECT_LIBRARY} WHERE l.id = ?1"),
            [id],
            library_row,
        )
        .optional()?
        .ok_or_else(|| LibraryError::new("library_not_found", "The problem library was not found"))
}

pub(super) fn set_library_status(
    connection: &mut Connection,
    id: &str,
    status: LibraryStatus,
) -> Result<LibraryInfo> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut library = get_library(&transaction, id)?;
    if library.status == "uninstalled" && status != LibraryStatus::Uninstalled {
        return Err(LibraryError::new(
            "library_uninstalled",
            "Reinstall this library with its package first",
        ));
    }
    transaction.execute(
        "UPDATE libraries SET status = ?1 WHERE id = ?2",
        params![status.as_str(), id],
    )?;
    library.status = status.as_str().to_owned();
    transaction.commit()?;
    Ok(library)
}

#[cfg(test)]
pub(super) fn install(connection: &mut Connection, package: Package) -> Result<ImportSummary> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let summary = install_package(&transaction, package)?;
    transaction.commit()?;
    Ok(summary)
}

#[cfg(desktop)]
pub(super) fn install_batch(
    connection: &mut Connection,
    packages: Vec<Package>,
) -> Result<Vec<ImportSummary>> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let summaries = packages
        .into_iter()
        .map(|package| install_package(&transaction, package))
        .collect::<Result<Vec<_>>>()?;
    transaction.commit()?;
    Ok(summaries)
}

fn install_package(transaction: &Transaction<'_>, package: Package) -> Result<ImportSummary> {
    let current = transaction
        .query_row(
            "SELECT release_version, package_hash, status FROM libraries WHERE id = ?1",
            [&package.library_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let author_name = package.author_name.as_ref();
    let author_name_zh_cn = author_name.and_then(|name| name.zh_cn.as_deref());
    let author_name_en = author_name.and_then(|name| name.en.as_deref());
    let mut summary = ImportSummary {
        library: LibraryInfo {
            id: package.library_id.clone(),
            name: package.name.clone(),
            author_id: package.author_id.clone(),
            author_name: package.author_name.clone(),
            release_version: package.release_version,
            status: if current
                .as_ref()
                .is_some_and(|(_, _, status)| status == "disabled")
            {
                "disabled".to_owned()
            } else {
                "enabled".to_owned()
            },
            problem_count: 0,
        },
        inserted: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        restored: 0,
        replayed: false,
    };
    if let Some((version, hash, status)) = current {
        if package.release_version < version {
            return Err(LibraryError::new(
                "stale_release",
                format!(
                    "Library {} already has release {version}",
                    package.library_id
                ),
            ));
        }
        if package.release_version == version {
            if package.hash != hash {
                return Err(LibraryError::new(
                    "release_conflict",
                    format!(
                        "Library {} has different content at release {version}",
                        package.library_id
                    ),
                ));
            }
            if status == "uninstalled" {
                transaction.execute(
                    "UPDATE libraries SET status = 'enabled' WHERE id = ?1",
                    [&package.library_id],
                )?;
            }
            summary.library = get_library(transaction, &package.library_id)?;
            summary.unchanged = package.problems.len();
            summary.replayed = true;
            return Ok(summary);
        }
    }
    transaction.execute(
        "INSERT INTO libraries (id, name_zh_cn, name_en, release_version, package_hash, status,
                                author_id, author_name_zh_cn, author_name_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO UPDATE SET name_zh_cn = excluded.name_zh_cn, name_en = excluded.name_en,
            release_version = excluded.release_version, package_hash = excluded.package_hash,
            status = excluded.status, author_id = excluded.author_id,
            author_name_zh_cn = excluded.author_name_zh_cn, author_name_en = excluded.author_name_en",
        params![package.library_id, package.name.zh_cn, package.name.en, package.release_version,
                package.hash, summary.library.status, package.author_id, author_name_zh_cn, author_name_en],
    )?;
    write_taxonomy(transaction, &package)?;

    // Track only previously visible rows when calculating removals for a complete snapshot.
    let mut omitted = std::collections::HashSet::new();
    if package.complete {
        let mut query =
            transaction.prepare("SELECT id FROM problems WHERE library_id = ?1 AND removed = 0")?;
        omitted = query
            .query_map([&package.library_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
    }
    for problem in &package.problems {
        omitted.remove(&problem.id);
        write_problem(transaction, &package, problem, &mut summary)?;
    }
    let mut remove = transaction.prepare_cached("UPDATE problems SET removed = 1 WHERE id = ?1")?;
    for id in omitted {
        summary.removed += remove.execute([id])?;
    }
    summary.library = get_library(transaction, &package.library_id)?;
    Ok(summary)
}

fn write_taxonomy(transaction: &Transaction<'_>, package: &Package) -> Result<()> {
    if package.complete {
        transaction.execute(
            "UPDATE archives SET removed = 1 WHERE library_id = ?1 AND removed = 0",
            [&package.library_id],
        )?;
    }
    let mut archive = transaction.prepare_cached(
        "INSERT INTO archives (library_id, id, parent_id, name_zh_cn, name_en, sort_order, removed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT (library_id, id) DO UPDATE SET parent_id = excluded.parent_id,
            name_zh_cn = excluded.name_zh_cn, name_en = excluded.name_en,
            sort_order = excluded.sort_order, removed = 0",
    )?;
    // The package validates the final tree and SQLite checks parent references at commit.
    for item in &package.archives {
        archive.execute(params![
            package.library_id,
            item.id,
            item.parent_id,
            item.name.zh_cn,
            item.name.en,
            item.sort_order
        ])?;
    }
    let mut tag = transaction.prepare_cached(
        "INSERT INTO tags (library_id, id, name_zh_cn, name_en) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (library_id, id) DO UPDATE SET name_zh_cn = excluded.name_zh_cn, name_en = excluded.name_en",
    )?;
    for item in &package.tags {
        tag.execute(params![
            package.library_id,
            item.id,
            item.name.zh_cn,
            item.name.en
        ])?;
    }
    Ok(())
}

fn write_problem(
    transaction: &Transaction<'_>,
    package: &Package,
    problem: &Problem,
    summary: &mut ImportSummary,
) -> Result<()> {
    let existing = transaction
        .prepare_cached("SELECT content_hash, removed FROM problems WHERE id = ?1")?
        .query_row([&problem.id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
        })
        .optional()?;
    if let Some((hash, removed)) = &existing {
        if hash == &problem.hash {
            if *removed {
                transaction
                    .prepare_cached("UPDATE problems SET removed = 0 WHERE id = ?1")?
                    .execute([&problem.id])?;
                summary.restored += 1;
            } else {
                summary.unchanged += 1;
            }
            return Ok(());
        }
        transaction.prepare_cached("UPDATE problems SET content_version = ?1, content_hash = ?2, removed = 0 WHERE id = ?3")?
            .execute(params![package.release_version, problem.hash, problem.id])?;
        if *removed {
            summary.restored += 1;
        } else {
            summary.updated += 1;
        }
    } else {
        transaction.prepare_cached(
            "INSERT INTO problems (id, library_id, author_id, sequence, content_version, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?.execute(params![problem.id, package.library_id, problem.author_id, problem.sequence, package.release_version, problem.hash])?;
        summary.inserted += 1;
    }

    let version = package.release_version;
    let author = problem.author_name.as_ref();
    transaction
        .prepare_cached(
            "INSERT INTO problem_versions (problem_id, content_version, title_zh_cn, title_en,
             statement_zh_cn, statement_en, author_name_zh_cn, author_name_en, rating, archive_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?
        .execute(params![
            problem.id,
            version,
            problem.title.zh_cn,
            problem.title.en,
            problem.statement.zh_cn,
            problem.statement.en,
            author.and_then(|text| text.zh_cn.as_deref()),
            author.and_then(|text| text.en.as_deref()),
            problem.rating,
            problem.archive_id
        ])?;
    let mut tags = transaction.prepare_cached(
        "INSERT INTO problem_tags (problem_id, content_version, library_id, tag_id) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for id in &problem.tags {
        tags.execute(params![problem.id, version, package.library_id, id])?;
    }
    let mut solutions = transaction.prepare_cached(
        "INSERT INTO solutions (problem_id, content_version, id, title_zh_cn, title_en, body_zh_cn, body_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for item in &problem.solutions {
        solutions.execute(params![
            problem.id,
            version,
            item.id,
            item.title.zh_cn,
            item.title.en,
            item.body.zh_cn,
            item.body.en
        ])?;
    }
    Ok(())
}
