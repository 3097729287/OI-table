use chrono::Utc;
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::{LibraryError, Result};

const BUILTIN_GROUPS: [(&str, &str); 3] = [
    ("to-do", "To do"),
    ("mistakes", "Mistakes"),
    ("review", "To review"),
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CollectionRequest {
    pub(super) id: Option<String>,
    pub(super) name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalCollection {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) problem_count: i64,
    pub(super) builtin: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalMemberships {
    pub(super) favorite_ids: Vec<String>,
}

fn builtin_name(id: &str) -> Option<&'static str> {
    BUILTIN_GROUPS
        .iter()
        .find_map(|(key, name)| (*key == id).then_some(*name))
}

fn collection_not_found() -> LibraryError {
    LibraryError::new("personal_not_found", "The favorite group was not found")
}

fn check_builtin(id: &str) -> Result<()> {
    if builtin_name(id).is_some() {
        return Err(LibraryError::new(
            "personal_builtin",
            "Built-in favorite groups cannot be changed",
        ));
    }
    Ok(())
}

fn collection_row(row: &Row<'_>) -> rusqlite::Result<PersonalCollection> {
    let id: String = row.get(0)?;
    Ok(PersonalCollection {
        builtin: builtin_name(&id).is_some(),
        id,
        name: row.get(1)?,
        problem_count: row.get(2)?,
    })
}

fn read_collections(connection: &Connection, id: Option<&str>) -> Result<Vec<PersonalCollection>> {
    let mut statement = connection.prepare(
        "SELECT g.id, g.name, (SELECT count(*) FROM favorites WHERE group_id = g.id)
         FROM personal_favorite_groups g WHERE ?1 IS NULL OR g.id = ?1
         ORDER BY g.sort_order, g.name COLLATE NOCASE, g.id",
    )?;
    let collections = statement
        .query_map([id], collection_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(collections)
}

pub(super) fn list_collections(connection: &Connection) -> Result<Vec<PersonalCollection>> {
    let mut groups = read_collections(connection, None)?;
    let mut collections = Vec::with_capacity(groups.len() + BUILTIN_GROUPS.len());
    for (id, name) in BUILTIN_GROUPS {
        let group = groups
            .iter()
            .position(|group| group.id == id)
            .map(|index| groups.remove(index))
            .unwrap_or_else(|| PersonalCollection {
                id: id.to_owned(),
                name: name.to_owned(),
                problem_count: 0,
                builtin: true,
            });
        collections.push(group);
    }
    collections.extend(groups);
    Ok(collections)
}

pub(super) fn save_collection(
    connection: &mut Connection,
    request: CollectionRequest,
) -> Result<PersonalCollection> {
    let CollectionRequest { id, name } = request;
    if let Some(id) = id.as_deref() {
        check_builtin(id)?;
    }
    let name = name.trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err(LibraryError::new(
            "personal_invalid_name",
            "Enter a favorite group name",
        ));
    }

    let write = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let id: String = if let Some(id) = id {
        let changed = write.execute(
            "UPDATE personal_favorite_groups SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
        if changed == 0 {
            return Err(collection_not_found());
        }
        id
    } else {
        write.query_row(
            "INSERT INTO personal_favorite_groups (id, name)
             VALUES (lower(hex(randomblob(16))), ?1) RETURNING id",
            [name],
            |row| row.get(0),
        )?
    };
    let collection = read_collections(&write, Some(&id))?
        .into_iter()
        .next()
        .ok_or_else(collection_not_found)?;
    write.commit()?;
    Ok(collection)
}

pub(super) fn delete_collection(connection: &Connection, id: &str) -> Result<()> {
    check_builtin(id)?;
    if connection.execute("DELETE FROM personal_favorite_groups WHERE id = ?1", [id])? == 0 {
        return Err(collection_not_found());
    }
    Ok(())
}

pub(super) fn memberships(
    connection: &Connection,
    problem_id: &str,
) -> Result<PersonalMemberships> {
    let mut statement = connection
        .prepare("SELECT group_id FROM favorites WHERE problem_id = ?1 ORDER BY group_id")?;
    let favorite_ids = statement
        .query_map([problem_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(PersonalMemberships { favorite_ids })
}

pub(super) fn set_membership(
    connection: &mut Connection,
    id: &str,
    problem_id: &str,
    included: bool,
) -> Result<()> {
    if !included {
        connection.execute(
            "DELETE FROM favorites WHERE group_id = ?1 AND problem_id = ?2",
            params![id, problem_id],
        )?;
        return Ok(());
    }

    let write = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let problem_exists: bool = write.query_row(
        "SELECT EXISTS (SELECT 1 FROM problems WHERE id = ?1)",
        [problem_id],
        |row| row.get(0),
    )?;
    if !problem_exists {
        return Err(LibraryError::new(
            "problem_not_found",
            "The problem was not found",
        ));
    }

    if let Some(name) = builtin_name(id) {
        write.execute(
            "INSERT INTO personal_favorite_groups (id, name) VALUES (?1, ?2)
             ON CONFLICT (id) DO NOTHING",
            params![id, name],
        )?;
    } else if !write.query_row(
        "SELECT EXISTS (SELECT 1 FROM personal_favorite_groups WHERE id = ?1)",
        [id],
        |row| row.get::<_, bool>(0),
    )? {
        return Err(collection_not_found());
    }
    write.execute(
        "INSERT INTO favorites (group_id, problem_id, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (group_id, problem_id) DO NOTHING",
        params![id, problem_id, Utc::now().timestamp_millis()],
    )?;
    write.commit()?;
    Ok(())
}
