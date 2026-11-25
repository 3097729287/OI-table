use rusqlite::{named_params, params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::{package::LocalizedText, LibraryError, Result};

const PAGE_SIZE: usize = 50;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProblemQuery {
    pub(super) library_id: Option<String>,
    pub(super) archive_id: Option<String>,
    #[serde(default)]
    pub(super) include_descendants: bool,
    pub(super) tag_id: Option<String>,
    #[serde(default)]
    pub(super) untagged: bool,
    pub(super) keyword: Option<String>,
    pub(super) after: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProblemSummary {
    id: String,
    library_id: String,
    author_id: String,
    sequence: i64,
    content_version: i64,
    title: LocalizedText,
    rating: Option<u32>,
    archive_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProblemPage {
    pub(super) items: Vec<ProblemSummary>,
    pub(super) next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProblemDetail {
    #[serde(flatten)]
    summary: ProblemSummary,
    statement: LocalizedText,
    author_name: Option<LocalizedText>,
    removed: bool,
    library_status: String,
    tags: Vec<TagInfo>,
    solutions: Vec<SolutionInfo>,
}

#[derive(Debug, Serialize)]
struct TagInfo {
    id: String,
    name: LocalizedText,
}

#[derive(Debug, Serialize)]
struct SolutionInfo {
    id: String,
    title: LocalizedText,
    body: LocalizedText,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveInfo {
    id: String,
    parent_id: Option<String>,
    name: LocalizedText,
    sort_order: i32,
    problem_count: i64,
    subtree_problem_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagGroup {
    id: Option<String>,
    name: Option<LocalizedText>,
    problem_count: i64,
}

fn localized(row: &Row<'_>, index: usize) -> rusqlite::Result<LocalizedText> {
    Ok(LocalizedText {
        zh_cn: row.get(index)?,
        en: row.get(index + 1)?,
    })
}

fn problem_row(row: &Row<'_>) -> rusqlite::Result<ProblemSummary> {
    Ok(ProblemSummary {
        id: row.get(0)?,
        library_id: row.get(1)?,
        author_id: row.get(2)?,
        sequence: row.get(3)?,
        content_version: row.get(4)?,
        title: localized(row, 5)?,
        rating: row.get(7)?,
        archive_id: row.get(8)?,
    })
}

pub(super) fn list_problems(connection: &Connection, query: ProblemQuery) -> Result<ProblemPage> {
    if query.archive_id.is_some() && query.library_id.is_none() {
        return Err(LibraryError::new(
            "invalid_query",
            "An archive filter requires a library ID",
        ));
    }
    if query.untagged && query.tag_id.is_some() {
        return Err(LibraryError::new(
            "invalid_query",
            "Choose either a tag or untagged problems",
        ));
    }
    let mut statement = connection.prepare(
        "WITH RECURSIVE archive_scope(id) AS (
             SELECT id FROM archives WHERE library_id = :library AND id = :archive AND removed = 0
             UNION ALL
             SELECT a.id FROM archive_scope s
             JOIN archives a ON a.library_id = :library AND a.parent_id = s.id AND a.removed = 0
             WHERE :include_descendants
         )
         SELECT p.id, p.library_id, p.author_id, p.sequence, v.content_version, v.title_zh_cn, v.title_en,
            v.rating, v.archive_id
         FROM problems p
         JOIN libraries l ON l.id = p.library_id
         JOIN problem_versions v ON v.problem_id = p.id AND v.content_version = p.content_version
         WHERE l.status = 'enabled' AND p.removed = 0 AND p.id > :after
           AND (:library IS NULL OR p.library_id = :library)
           AND (:archive IS NULL OR v.archive_id IN (SELECT id FROM archive_scope))
           AND (:tag IS NULL OR EXISTS (
                SELECT 1 FROM problem_tags pt
                WHERE pt.problem_id = p.id AND pt.content_version = p.content_version
                  AND pt.library_id = p.library_id AND pt.tag_id = :tag
           ))
           AND (:untagged = 0 OR NOT EXISTS (
                SELECT 1 FROM problem_tags pt
                WHERE pt.problem_id = p.id AND pt.content_version = p.content_version
           ))
           AND (:keyword = '' OR p.id = :keyword OR instr(lower(v.title_zh_cn), lower(:keyword)) > 0
                OR instr(lower(v.title_en), lower(:keyword)) > 0)
         ORDER BY p.id LIMIT :limit",
    )?;
    let mut items = statement
        .query_map(
            named_params! {
                ":after": query.after.as_deref().unwrap_or_default(),
                ":library": query.library_id,
                ":archive": query.archive_id,
                ":include_descendants": query.include_descendants,
                ":tag": query.tag_id,
                ":untagged": query.untagged,
                ":keyword": query.keyword.as_deref().unwrap_or_default().trim(),
                ":limit": (PAGE_SIZE + 1) as i64,
            },
            problem_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = items.len() > PAGE_SIZE;
    items.truncate(PAGE_SIZE);
    let next_cursor = has_more.then(|| items[PAGE_SIZE - 1].id.clone());
    Ok(ProblemPage { items, next_cursor })
}

pub(super) fn get_problem(
    connection: &Connection,
    id: &str,
    version: Option<i64>,
) -> Result<ProblemDetail> {
    let read = connection.unchecked_transaction()?;
    let mut detail = read.query_row(
        "SELECT p.id, p.library_id, p.author_id, p.sequence, v.content_version, v.title_zh_cn, v.title_en,
            v.rating, v.archive_id, v.statement_zh_cn, v.statement_en,
            v.author_name_zh_cn, v.author_name_en, p.removed, l.status
         FROM problems p
         JOIN libraries l ON l.id = p.library_id
         JOIN problem_versions v ON v.problem_id = p.id AND v.content_version = coalesce(?2, p.content_version)
         WHERE p.id = ?1",
        params![id, version],
        |row| {
            let author = localized(row, 11)?;
            Ok(ProblemDetail {
            summary: problem_row(row)?,
            statement: localized(row, 9)?,
            author_name: (author.zh_cn.is_some() || author.en.is_some()).then_some(author),
            removed: row.get(13)?,
            library_status: row.get(14)?,
            tags: Vec::new(),
            solutions: Vec::new(),
            })
        },
    ).optional()?.ok_or_else(|| LibraryError::new("problem_not_found", "The problem or requested version was not found"))?;

    {
        let mut tags = read.prepare(
            "SELECT t.id, t.name_zh_cn, t.name_en FROM problem_tags pt
             JOIN tags t ON t.library_id = pt.library_id AND t.id = pt.tag_id
             WHERE pt.problem_id = ?1 AND pt.content_version = ?2 ORDER BY t.id",
        )?;
        detail.tags = tags
            .query_map(params![id, detail.summary.content_version], |row| {
                Ok(TagInfo {
                    id: row.get(0)?,
                    name: localized(row, 1)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut solutions = read.prepare(
            "SELECT id, title_zh_cn, title_en, body_zh_cn, body_en FROM solutions
             WHERE problem_id = ?1 AND content_version = ?2 ORDER BY id",
        )?;
        detail.solutions = solutions
            .query_map(params![id, detail.summary.content_version], |row| {
                Ok(SolutionInfo {
                    id: row.get(0)?,
                    title: localized(row, 1)?,
                    body: localized(row, 3)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
    }
    read.commit()?;
    Ok(detail)
}

pub(super) fn archive_children(
    connection: &Connection,
    library_id: &str,
    parent_id: Option<&str>,
) -> Result<Vec<ArchiveInfo>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE
         children AS (
             SELECT a.id, a.parent_id, a.name_zh_cn, a.name_en, a.sort_order
             FROM archives a JOIN libraries l ON l.id = a.library_id
             WHERE a.library_id = ?1 AND a.parent_id IS ?2 AND a.removed = 0 AND l.status = 'enabled'
         ),
         subtree(root_id, archive_id) AS (
             SELECT id, id FROM children
             UNION ALL
             SELECT s.root_id, a.id FROM subtree s
             JOIN archives a ON a.library_id = ?1 AND a.parent_id = s.archive_id AND a.removed = 0
         ),
         counts AS (
             SELECT s.root_id, count(*) FILTER (WHERE s.root_id = s.archive_id) AS direct,
                    count(*) AS total
             FROM subtree s
             JOIN problem_versions v ON v.archive_id = s.archive_id
             JOIN problems p ON p.id = v.problem_id AND p.content_version = v.content_version
                 AND p.library_id = ?1 AND p.removed = 0
             GROUP BY s.root_id
         )
         SELECT c.id, c.parent_id, c.name_zh_cn, c.name_en, c.sort_order,
                coalesce(counts.direct, 0), coalesce(counts.total, 0)
         FROM children c LEFT JOIN counts ON counts.root_id = c.id
         ORDER BY c.sort_order, c.id",
    )?;
    let children = statement
        .query_map(params![library_id, parent_id], |row| {
            Ok(ArchiveInfo {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: localized(row, 2)?,
                sort_order: row.get(4)?,
                problem_count: row.get(5)?,
                subtree_problem_count: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(children)
}

pub(super) fn tag_groups(
    connection: &Connection,
    library_id: Option<&str>,
) -> Result<Vec<TagGroup>> {
    // A shared tag uses the name from the first library that contributes a problem.
    let mut statement = connection.prepare(
        "WITH counts AS (
             SELECT pt.tag_id, min(p.library_id) AS name_library, count(*) AS problem_count
             FROM problems p JOIN libraries l ON l.id = p.library_id
             LEFT JOIN problem_tags pt ON pt.problem_id = p.id AND pt.content_version = p.content_version
                 AND pt.library_id = p.library_id
             WHERE l.status = 'enabled' AND p.removed = 0 AND (?1 IS NULL OR p.library_id = ?1)
             GROUP BY pt.tag_id
         )
         SELECT c.tag_id, t.name_zh_cn, t.name_en, c.problem_count
         FROM counts c LEFT JOIN tags t ON t.library_id = c.name_library AND t.id = c.tag_id
         ORDER BY c.tag_id IS NULL, c.tag_id",
    )?;
    let groups = statement
        .query_map([library_id], |row| {
            let id: Option<String> = row.get(0)?;
            Ok(TagGroup {
                name: id.as_ref().map(|_| localized(row, 1)).transpose()?,
                id,
                problem_count: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(groups)
}
