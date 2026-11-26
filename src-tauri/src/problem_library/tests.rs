use std::{fs, path::Path};

use rusqlite::Connection;
use serde_json::{json, Value};
use tempfile::TempDir;

use super::{
    db::{self, ImportSummary, LibraryStatus},
    package::{self, PackageFile},
    personal::{self, CollectionRequest},
    query::{self, PersonalScope, ProblemQuery},
    Result,
};

const BASICS: &str = "example-basics";
const GRAPHS: &str = "example-graphs";
const RANGE_SUMS: &str = "example-basics:demo:1";
const PARENTHESIS_DEPTH: &str = "example-basics:demo:2";
const COMPONENTS: &str = "example-graphs:demo:1";

fn fixture_files(library: &str) -> Vec<PackageFile> {
    fn read_directory(root: &Path, directory: &Path, files: &mut Vec<PackageFile>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                read_directory(root, &path, files);
            } else {
                files.push(PackageFile {
                    path: path
                        .strip_prefix(root)
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .replace('\\', "/"),
                    text: fs::read_to_string(&path).unwrap(),
                });
            }
        }
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../examples/problem-libraries")
        .join(library);
    let mut files = Vec::new();
    read_directory(&root, &root, &mut files);
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}

fn edit_manifest(files: &mut [PackageFile], update: impl FnOnce(&mut Value)) {
    let file = files
        .iter_mut()
        .find(|file| file.path == "manifest.json")
        .unwrap();
    let mut manifest = serde_json::from_str(&file.text).unwrap();
    update(&mut manifest);
    file.text = manifest.to_string();
}

fn graph_fixture_with_sequences_archive() -> Vec<PackageFile> {
    let mut files = fixture_files(GRAPHS);
    edit_manifest(&mut files, |manifest| {
        manifest["archives"][0]["id"] = json!("sequences");
        manifest["problems"][0]["archiveId"] = json!("sequences");
    });
    files
}

fn replace_text(files: &mut [PackageFile], path: &str, text: &str) {
    files
        .iter_mut()
        .find(|file| file.path == path)
        .unwrap()
        .text = text.to_owned();
}

fn single_problem_release(version: i64, complete: bool, statement: &str) -> Vec<PackageFile> {
    let mut files = fixture_files(BASICS);
    files.retain(|file| !file.path.starts_with("parenthesis-depth/"));
    edit_manifest(&mut files, |manifest| {
        manifest["releaseVersion"] = json!(version);
        manifest["complete"] = json!(complete);
        manifest["problems"].as_array_mut().unwrap().truncate(1);
    });
    replace_text(&mut files, "range-sums/statement.en.md", statement);
    files
}

fn test_database() -> (TempDir, Connection) {
    let directory = tempfile::tempdir().unwrap();
    let connection = db::open(&directory.path().join(db::DATABASE_FILE)).unwrap();
    (directory, connection)
}

fn install(connection: &mut Connection, files: Vec<PackageFile>) -> Result<ImportSummary> {
    db::install(connection, package::read_package(files)?)
}

fn detail(connection: &Connection, id: &str, version: Option<i64>) -> Value {
    serde_json::to_value(query::get_problem(connection, id, version).unwrap()).unwrap()
}

fn archives(connection: &Connection, library_id: &str, parent_id: Option<&str>) -> Value {
    serde_json::to_value(query::archive_children(connection, library_id, parent_id).unwrap())
        .unwrap()
}

fn listed_ids(connection: &Connection, filters: ProblemQuery) -> Vec<String> {
    let page = serde_json::to_value(query::list_problems(connection, filters).unwrap()).unwrap();
    let mut ids: Vec<_> = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect();
    ids.sort();
    ids
}

#[test]
fn installs_two_bilingual_libraries_with_independent_releases() {
    let (_directory, mut connection) = test_database();
    assert_eq!(
        install(&mut connection, fixture_files(BASICS))
            .unwrap()
            .inserted,
        2
    );
    assert_eq!(
        install(&mut connection, graph_fixture_with_sequences_archive())
            .unwrap()
            .inserted,
        1
    );

    let mut reordered = fixture_files(BASICS);
    reordered.reverse();
    let replay = install(&mut connection, reordered).unwrap();
    assert!(replay.replayed);
    assert_eq!(
        (replay.inserted, replay.updated, replay.unchanged),
        (0, 0, 2)
    );

    let libraries = db::list_libraries(&connection).unwrap();
    assert_eq!(
        libraries
            .iter()
            .map(|entry| (entry.id.as_str(), entry.release_version))
            .collect::<Vec<_>>(),
        [(BASICS, 1), (GRAPHS, 7)]
    );
    assert_eq!(
        serde_json::to_value(&libraries[0]).unwrap()["name"],
        json!({
            "zhCN": "基础算法示例库", "en": "Basic Algorithms Example Library"
        })
    );

    let basic = detail(&connection, RANGE_SUMS, None);
    assert_eq!(basic["id"], RANGE_SUMS);
    assert_eq!(
        basic["title"],
        json!({ "zhCN": "区间求和", "en": "Range Sums" })
    );
    assert_eq!(
        basic["authorName"],
        json!({ "zhCN": "示例作者", "en": "Example Author" })
    );
    assert!(basic["statement"]["zhCN"]
        .as_str()
        .unwrap()
        .contains("包含两端"));
    assert!(basic["statement"]["en"]
        .as_str()
        .unwrap()
        .contains("inclusive"));
    assert_eq!(
        basic["solutions"][0]["title"],
        json!({ "zhCN": "前缀和", "en": "Prefix Sums" })
    );
    assert!(basic["solutions"][0]["body"]["zhCN"]
        .as_str()
        .unwrap()
        .contains("前缀和"));
    assert!(basic["solutions"][0]["body"]["en"]
        .as_str()
        .unwrap()
        .contains("prefix sums"));
    assert_eq!(basic["archiveId"], "sequences");
    assert_eq!(basic["rating"], 900);

    let graph = detail(&connection, COMPONENTS, None);
    assert_eq!(
        graph["title"],
        json!({ "zhCN": "连通分量", "en": "Connected Components" })
    );
    assert_eq!(graph["contentVersion"], 7);
    assert_eq!(graph["authorId"], basic["authorId"]);
    assert_eq!(graph["sequence"], basic["sequence"]);

    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [RANGE_SUMS, PARENTHESIS_DEPTH, COMPONENTS]
    );
    assert_eq!(
        listed_ids(
            &connection,
            ProblemQuery {
                library_id: Some(BASICS.to_owned()),
                tag_id: Some("prefix-sums".to_owned()),
                ..ProblemQuery::default()
            }
        ),
        [RANGE_SUMS]
    );
    let roots = archives(&connection, BASICS, None);
    assert_eq!(roots[0]["id"], "algorithms");
    assert_eq!(roots[0]["problemCount"], 0);
    assert_eq!(roots[0]["subtreeProblemCount"], 2);

    let children = archives(&connection, BASICS, Some("algorithms"));
    assert_eq!(children[0]["id"], "sequences");
    assert_eq!(children[0]["problemCount"], 2);
    assert_eq!(children[0]["subtreeProblemCount"], 2);

    let graph_roots = archives(&connection, GRAPHS, None);
    assert_eq!(graph_roots[0]["id"], "sequences");
    assert_eq!(graph_roots[0]["subtreeProblemCount"], 1);
}

#[test]
fn groups_current_enabled_problems_by_all_their_tags() {
    let (_directory, mut connection) = test_database();
    let shared_tag = "prefix-sums";
    let mut graph = fixture_files(GRAPHS);
    edit_manifest(&mut graph, |manifest| {
        manifest["tags"].as_array_mut().unwrap().push(json!({
            "id": shared_tag,
            "name": { "en": "Graph Prefix Sums" }
        }));
        manifest["problems"][0]["tags"] = json!(["traversal", shared_tag]);
    });
    install(&mut connection, graph).unwrap();

    let mut basics = fixture_files(BASICS);
    edit_manifest(&mut basics, |manifest| {
        manifest["problems"][0]["tags"] = json!([shared_tag, "scan"]);
        manifest["problems"][1]["tags"] = json!([]);
    });
    install(&mut connection, basics).unwrap();

    let groups = |connection: &Connection, library| {
        serde_json::to_value(query::tag_groups(connection, library).unwrap()).unwrap()
    };
    let untagged = json!({ "id": null, "name": null, "problemCount": 1 });
    assert_eq!(
        groups(&connection, None),
        json!([
            { "id": shared_tag, "name": { "zhCN": "前缀和", "en": "Prefix Sums" }, "problemCount": 2 },
            { "id": "scan", "name": { "zhCN": "线性扫描", "en": "Linear Scan" }, "problemCount": 1 },
            { "id": "traversal", "name": { "zhCN": "图遍历", "en": "Graph Traversal" }, "problemCount": 1 },
            untagged
        ])
    );
    assert_eq!(
        groups(&connection, Some(GRAPHS))[0],
        json!({ "id": shared_tag, "name": { "zhCN": null, "en": "Graph Prefix Sums" }, "problemCount": 1 })
    );
    assert_eq!(
        listed_ids(
            &connection,
            ProblemQuery {
                tag_id: Some(shared_tag.to_owned()),
                ..ProblemQuery::default()
            }
        ),
        [RANGE_SUMS, COMPONENTS]
    );
    assert_eq!(
        listed_ids(
            &connection,
            ProblemQuery {
                tag_id: Some("scan".to_owned()),
                ..ProblemQuery::default()
            }
        ),
        [RANGE_SUMS]
    );
    assert_eq!(
        listed_ids(
            &connection,
            ProblemQuery {
                untagged: true,
                ..ProblemQuery::default()
            }
        ),
        [PARENTHESIS_DEPTH]
    );
    assert_eq!(
        query::list_problems(
            &connection,
            ProblemQuery {
                tag_id: Some(shared_tag.to_owned()),
                untagged: true,
                ..ProblemQuery::default()
            }
        )
        .unwrap_err()
        .code,
        "invalid_query"
    );

    let mut update = single_problem_release(2, true, "Updated range sums statement.");
    edit_manifest(&mut update, |manifest| {
        manifest["problems"][0]["tags"] = json!([]);
    });
    install(&mut connection, update).unwrap();
    assert_eq!(groups(&connection, Some(BASICS)), json!([untagged]));
    db::set_library_status(&mut connection, GRAPHS, LibraryStatus::Disabled).unwrap();
    assert_eq!(groups(&connection, None), json!([untagged]));
    assert_eq!(groups(&connection, Some(GRAPHS)), json!([]));
    assert!(listed_ids(
        &connection,
        ProblemQuery {
            tag_id: Some(shared_tag.to_owned()),
            ..ProblemQuery::default()
        }
    )
    .is_empty());
}

#[test]
fn records_the_organizer_in_an_empty_library_release() {
    let (_directory, mut connection) = test_database();
    let mut files = fixture_files(BASICS);
    files.retain(|file| file.path == "manifest.json");
    edit_manifest(&mut files, |manifest| manifest["problems"] = json!([]));

    let imported = install(
        &mut connection,
        vec![PackageFile {
            path: files[0].path.clone(),
            text: files[0].text.clone(),
        }],
    )
    .unwrap();
    assert_eq!(imported.inserted, 0);
    assert_eq!(imported.library.author_id, "demo");

    let listed = db::list_libraries(&connection).unwrap();
    let name = listed[0].author_name.as_ref().unwrap();
    assert_eq!(name.zh_cn.as_deref(), Some("示例作者"));
    assert_eq!(name.en.as_deref(), Some("Example Author"));

    edit_manifest(&mut files, |manifest| {
        manifest["authorName"]["en"] = json!("Different Author");
    });
    assert_eq!(
        install(&mut connection, files).unwrap_err().code,
        "release_conflict"
    );
}

#[test]
fn archive_problem_lists_can_include_descendants() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(&mut connection, graph_fixture_with_sequences_archive()).unwrap();

    let problems = |filters| listed_ids(&connection, serde_json::from_value(filters).unwrap());
    assert!(problems(json!({ "libraryId": BASICS, "archiveId": "algorithms" })).is_empty());
    assert_eq!(
        problems(json!({
            "libraryId": BASICS, "archiveId": "algorithms", "includeDescendants": true
        })),
        [RANGE_SUMS, PARENTHESIS_DEPTH]
    );
    let direct_child = problems(json!({ "libraryId": BASICS, "archiveId": "sequences" }));
    assert_eq!(direct_child, [RANGE_SUMS, PARENTHESIS_DEPTH]);
    assert_eq!(
        problems(json!({
            "libraryId": BASICS, "archiveId": "sequences", "includeDescendants": true
        })),
        direct_child
    );
    assert_eq!(
        problems(json!({
            "libraryId": BASICS, "archiveId": "algorithms", "includeDescendants": true,
            "keyword": "Range Sums"
        })),
        [RANGE_SUMS]
    );
}

#[test]
fn only_complete_releases_remove_omitted_problems_and_later_releases_can_restore_them() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(&mut connection, fixture_files(GRAPHS)).unwrap();
    let original = detail(&connection, RANGE_SUMS, None);

    let revised = "Return the inclusive sum for each query.";
    let partial = install(&mut connection, single_problem_release(2, false, revised)).unwrap();
    assert_eq!((partial.updated, partial.removed), (1, 0));
    assert_eq!(
        detail(&connection, RANGE_SUMS, None)["statement"]["en"],
        revised
    );
    assert_eq!(
        detail(&connection, RANGE_SUMS, Some(1))["statement"],
        original["statement"]
    );
    assert_eq!(
        detail(&connection, PARENTHESIS_DEPTH, None)["removed"],
        false
    );

    let full = install(&mut connection, single_problem_release(3, true, revised)).unwrap();
    assert_eq!((full.unchanged, full.removed), (1, 1));
    assert_eq!(detail(&connection, RANGE_SUMS, None)["contentVersion"], 2);
    assert_eq!(
        detail(&connection, PARENTHESIS_DEPTH, None)["removed"],
        true
    );
    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [RANGE_SUMS, COMPONENTS]
    );
    assert_eq!(
        archives(&connection, BASICS, None)[0]["subtreeProblemCount"],
        1
    );

    let mut restored_files = fixture_files(BASICS);
    edit_manifest(&mut restored_files, |manifest| {
        manifest["releaseVersion"] = json!(4)
    });
    replace_text(&mut restored_files, "range-sums/statement.en.md", revised);
    let restored = install(&mut connection, restored_files).unwrap();
    assert_eq!(
        (restored.updated, restored.restored, restored.inserted),
        (0, 1, 0)
    );
    let problem = detail(&connection, PARENTHESIS_DEPTH, None);
    assert_eq!(problem["id"], PARENTHESIS_DEPTH);
    assert_eq!(problem["removed"], false);
    assert_eq!(problem["contentVersion"], 1);
    assert_eq!(detail(&connection, COMPONENTS, None)["contentVersion"], 7);
    assert_eq!(
        archives(&connection, BASICS, None)[0]["subtreeProblemCount"],
        2
    );
}

#[test]
fn rejects_conflicting_older_and_incomplete_packages_without_mutating_data() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(
        &mut connection,
        single_problem_release(2, false, "Previously installed text."),
    )
    .unwrap();
    let snapshot = detail(&connection, RANGE_SUMS, None);

    let conflicting = single_problem_release(2, false, "Different text at the same release.");
    assert_eq!(
        install(&mut connection, conflicting).unwrap_err().code,
        "release_conflict"
    );
    assert_eq!(
        install(&mut connection, fixture_files(BASICS))
            .unwrap_err()
            .code,
        "stale_release"
    );

    let mut missing_statement = single_problem_release(3, true, "Newer text.");
    missing_statement.retain(|file| file.path != "range-sums/statement.zh-cn.md");
    assert_eq!(
        install(&mut connection, missing_statement)
            .unwrap_err()
            .code,
        "invalid_package"
    );

    assert_eq!(
        db::list_libraries(&connection).unwrap()[0].release_version,
        2
    );
    assert_eq!(detail(&connection, RANGE_SUMS, None), snapshot);
    assert_eq!(
        detail(&connection, PARENTHESIS_DEPTH, None)["removed"],
        false
    );
}

#[cfg(desktop)]
#[test]
fn installs_from_native_directory_and_zip_paths() {
    use std::io::Write;

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join(db::DATABASE_FILE);
    let folder = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../examples/problem-libraries")
        .join(BASICS);
    let source = super::infer_import_source(&folder).unwrap();
    assert!(matches!(source, super::ImportSource::Directory));
    let imported = super::install_from_path(&database, &folder, source).unwrap();
    assert_eq!(imported[0].inserted, 2);

    let path = directory.path().join("graph-library.ZIP");
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    for file in fixture_files(GRAPHS) {
        zip.start_file(file.path, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(file.text.as_bytes()).unwrap();
    }
    drop(zip.finish().unwrap());
    let source = super::infer_import_source(&path).unwrap();
    assert!(matches!(source, super::ImportSource::Zip));
    let imported = super::install_from_path(&database, &path, source).unwrap();
    assert_eq!(imported[0].inserted, 1);
    assert_eq!(
        listed_ids(&db::open(&database).unwrap(), ProblemQuery::default()),
        [RANGE_SUMS, PARENTHESIS_DEPTH, COMPONENTS]
    );
}

#[cfg(desktop)]
#[test]
fn rejects_relative_missing_and_unsupported_native_paths() {
    let directory = tempfile::tempdir().unwrap();
    let unsupported = directory.path().join("notes.txt");
    fs::write(&unsupported, "Not a package").unwrap();
    let missing = directory.path().join("missing.zip");
    for path in [Path::new("relative.zip"), &missing, &unsupported] {
        assert_eq!(
            super::infer_import_source(path).unwrap_err().code,
            "invalid_import_source"
        );
    }
}

#[cfg(desktop)]
#[test]
fn rolls_back_the_batch_when_a_later_library_conflicts() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(GRAPHS)).unwrap();
    let original_graph = detail(&connection, COMPONENTS, None);
    let mut conflicting = fixture_files(GRAPHS);
    replace_text(
        &mut conflicting,
        "connected-components/statement.en.md",
        "Different text at the same version.",
    );
    let batch = vec![
        package::read_package(fixture_files(BASICS)).unwrap(),
        package::read_package(conflicting).unwrap(),
    ];
    assert_eq!(
        db::install_batch(&mut connection, batch).unwrap_err().code,
        "release_conflict"
    );
    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [COMPONENTS]
    );
    assert_eq!(detail(&connection, COMPONENTS, None), original_graph);
    assert_eq!(db::list_libraries(&connection).unwrap().len(), 1);

    let batch = [BASICS, GRAPHS]
        .map(|id| package::read_package(fixture_files(id)).unwrap())
        .into();
    let summaries = db::install_batch(&mut connection, batch).unwrap();
    assert_eq!(summaries[0].inserted, 2);
    assert!(summaries[1].replayed);
    assert_eq!(db::list_libraries(&connection).unwrap().len(), 2);
}

#[test]
fn install_rolls_back_an_earlier_write_when_a_later_write_fails() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    let original = detail(&connection, RANGE_SUMS, None);
    connection
        .execute_batch(
            "CREATE TEMP TRIGGER fail_second_problem_version
         BEFORE INSERT ON problem_versions
         WHEN NEW.problem_id = 'example-basics:demo:2'
         BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
        )
        .unwrap();

    let update = || {
        let mut files = fixture_files(BASICS);
        edit_manifest(&mut files, |manifest| {
            manifest["releaseVersion"] = json!(2);
            manifest["archives"][1]["name"]["en"] = json!("Updated Sequences");
        });
        replace_text(
            &mut files,
            "range-sums/statement.en.md",
            "New range sums statement.",
        );
        replace_text(
            &mut files,
            "parenthesis-depth/statement.en.md",
            "New parenthesis depth statement.",
        );
        files
    };

    assert_eq!(
        install(&mut connection, update()).unwrap_err().code,
        "database"
    );
    assert_eq!(
        db::list_libraries(&connection).unwrap()[0].release_version,
        1
    );
    assert_eq!(detail(&connection, RANGE_SUMS, None), original);
    let archive_name: String = connection
        .query_row(
            "SELECT name_en FROM archives WHERE library_id = ?1 AND id = 'sequences'",
            [BASICS],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(archive_name, "Sequences");

    connection
        .execute_batch("DROP TRIGGER fail_second_problem_version")
        .unwrap();
    let retried = install(&mut connection, update()).unwrap();
    assert_eq!((retried.library.release_version, retried.updated), (2, 2));
}

#[test]
fn lists_submission_metadata_for_a_single_problem_across_versions() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(
        &mut connection,
        single_problem_release(2, false, "Updated range sums statement."),
    )
    .unwrap();

    let created_at = 1_795_580_000_000_i64;
    let insert = "INSERT INTO submissions (id, problem_id, content_version, source, language, created_at, status)
                  VALUES (?1, ?2, ?3, 'int main() {}', 'cpp', ?4, 'accepted')";
    let write = connection.transaction().unwrap();
    for index in 0..=50 {
        write
            .execute(
                insert,
                rusqlite::params![
                    format!("entry-{index:02}"),
                    RANGE_SUMS,
                    (index % 2) + 1,
                    created_at
                ],
            )
            .unwrap();
    }
    write
        .execute(
            insert,
            rusqlite::params!["earliest", RANGE_SUMS, 1, created_at - 1],
        )
        .unwrap();
    write
        .execute(
            insert,
            rusqlite::params!["other-problem", PARENTHESIS_DEPTH, 1, created_at + 1],
        )
        .unwrap();
    write.commit().unwrap();
    db::set_library_status(&mut connection, BASICS, LibraryStatus::Disabled).unwrap();

    let first = serde_json::to_value(
        query::list_problem_submissions(&connection, RANGE_SUMS, None).unwrap(),
    )
    .unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 50);
    assert_eq!(
        first["items"][0],
        json!({
            "id": "entry-00", "language": "cpp", "createdAt": created_at,
            "status": "accepted", "contentVersion": 1
        })
    );
    assert_eq!(first["items"][1]["contentVersion"], 2);
    assert_eq!(first["nextCursor"], "entry-49");

    let second = serde_json::to_value(
        query::list_problem_submissions(&connection, RANGE_SUMS, first["nextCursor"].as_str())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 2);
    assert_eq!(second["items"][0]["id"], "entry-50");
    assert_eq!(second["items"][1]["id"], "earliest");
    assert!(second["nextCursor"].is_null());
    assert_eq!(
        query::list_problem_submissions(&connection, RANGE_SUMS, Some("other-problem"))
            .unwrap_err()
            .code,
        "invalid_query"
    );
}

#[test]
fn disable_and_uninstall_hide_problems_but_reinstall_keeps_saved_references() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(&mut connection, fixture_files(GRAPHS)).unwrap();
    connection.execute_batch(
        "INSERT INTO problem_lists (id, name) VALUES ('practice', 'Practice');
         INSERT INTO problem_list_items (list_id, problem_id) VALUES ('practice', 'example-basics:demo:1');
         INSERT INTO personal_favorite_groups (id, name) VALUES ('saved', 'Saved');
         INSERT INTO favorites (group_id, problem_id, created_at) VALUES ('saved', 'example-basics:demo:1', 1);
         INSERT INTO submissions (id, problem_id, content_version, source, language, created_at, status)
             VALUES ('entry', 'example-basics:demo:1', 1, 'int main() {}', 'cpp', 1, 'accepted');",
    ).unwrap();

    db::set_library_status(&mut connection, BASICS, LibraryStatus::Disabled).unwrap();
    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [COMPONENTS]
    );
    assert!(query::archive_children(&connection, BASICS, None)
        .unwrap()
        .is_empty());
    assert_eq!(
        detail(&connection, RANGE_SUMS, None)["libraryStatus"],
        "disabled"
    );
    let replay = install(&mut connection, fixture_files(BASICS)).unwrap();
    assert_eq!(replay.library.status, "disabled");

    db::set_library_status(&mut connection, BASICS, LibraryStatus::Enabled).unwrap();
    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [RANGE_SUMS, PARENTHESIS_DEPTH, COMPONENTS]
    );
    db::set_library_status(&mut connection, BASICS, LibraryStatus::Uninstalled).unwrap();
    assert_eq!(
        listed_ids(&connection, ProblemQuery::default()),
        [COMPONENTS]
    );
    assert_eq!(
        detail(&connection, RANGE_SUMS, Some(1))["libraryStatus"],
        "uninstalled"
    );

    let reinstalled = install(&mut connection, fixture_files(BASICS)).unwrap();
    assert!(reinstalled.replayed);
    assert_eq!(reinstalled.library.status, "enabled");
    assert_eq!(detail(&connection, RANGE_SUMS, None)["id"], RANGE_SUMS);
    let referenced_version: i64 = connection
        .query_row(
            "SELECT submissions.content_version
         FROM problem_list_items
         JOIN favorites USING (problem_id)
         JOIN submissions USING (problem_id)
         WHERE list_id = 'practice' AND group_id = 'saved' AND id = 'entry' AND problem_id = ?1",
            [RANGE_SUMS],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(referenced_version, 1);
}

#[test]
fn opens_current_schema_and_reopens_installed_problems() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join(db::DATABASE_FILE);
    Connection::open(&database)
        .unwrap()
        .execute_batch(
            "CREATE TABLE earlier_data (value TEXT);
         INSERT INTO earlier_data VALUES ('preserved');",
        )
        .unwrap();

    let mut connection = db::open(&database).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    install(&mut connection, fixture_files(BASICS)).unwrap();
    drop(connection);

    let reopened = db::open(&database).unwrap();
    assert_eq!(detail(&reopened, RANGE_SUMS, None)["contentVersion"], 1);
    let value: String = reopened
        .query_row("SELECT value FROM earlier_data", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "preserved");
    assert!(reopened.execute(
        "INSERT INTO problem_list_items (list_id, problem_id) VALUES ('missing-list', 'missing-problem')", [],
    ).is_err());
}

#[test]
fn rejects_an_unsupported_database_without_modifying_it() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join(db::DATABASE_FILE);
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "PRAGMA user_version = 2;
             CREATE TABLE existing_data (value TEXT);
             INSERT INTO existing_data VALUES ('preserved');",
        )
        .unwrap();
    assert_eq!(
        db::open(&database).unwrap_err().code,
        "unsupported_database"
    );
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        2
    );
    let value: String = connection
        .query_row("SELECT value FROM existing_data", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "preserved");
}

fn collection_request(id: Option<&str>, name: &str) -> CollectionRequest {
    CollectionRequest {
        id: id.map(str::to_owned),
        name: name.to_owned(),
    }
}

fn personal_query(scope: PersonalScope) -> ProblemQuery {
    ProblemQuery {
        personal: Some(scope),
        ..ProblemQuery::default()
    }
}

#[test]
fn personal_favorites_preserve_independent_idempotent_memberships() {
    let (_directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    let defaults = personal::list_collections(&connection).unwrap();
    assert_eq!(
        defaults
            .iter()
            .map(|group| group.id.as_str())
            .collect::<Vec<_>>(),
        ["default"]
    );
    assert!(defaults[0].builtin);
    assert_eq!(defaults[0].name, "Default favorites");
    assert_eq!(defaults[0].problem_count, 0);
    assert_eq!(
        personal::delete_collection(&connection, "default")
            .unwrap_err()
            .code,
        "personal_builtin"
    );
    assert_eq!(
        personal::save_collection(
            &mut connection,
            collection_request(Some("default"), "Renamed")
        )
        .unwrap_err()
        .code,
        "personal_builtin"
    );
    assert_eq!(
        personal::save_collection(&mut connection, collection_request(None, " "))
            .unwrap_err()
            .code,
        "personal_invalid_name"
    );

    let group =
        personal::save_collection(&mut connection, collection_request(None, "  复盘  ")).unwrap();
    assert_eq!(group.name, "复盘");
    assert!(!group.builtin);
    let late =
        personal::save_collection(&mut connection, collection_request(None, "Zulu")).unwrap();
    let early =
        personal::save_collection(&mut connection, collection_request(None, "alpha")).unwrap();
    connection
        .execute(
            "UPDATE personal_favorite_groups SET sort_order = -1 WHERE id = ?1",
            [&group.id],
        )
        .unwrap();
    assert_eq!(
        personal::list_collections(&connection)
            .unwrap()
            .into_iter()
            .map(|group| group.id)
            .collect::<Vec<_>>(),
        [
            "default",
            group.id.as_str(),
            early.id.as_str(),
            late.id.as_str()
        ]
    );
    for id in ["default", "default", group.id.as_str()] {
        personal::set_membership(&mut connection, id, RANGE_SUMS, true).unwrap();
    }
    assert_eq!(
        personal::set_membership(&mut connection, "unknown-group", RANGE_SUMS, true)
            .unwrap_err()
            .code,
        "personal_not_found"
    );
    assert_eq!(
        listed_ids(&connection, personal_query(PersonalScope::Favorites)),
        [RANGE_SUMS]
    );
    let renamed = personal::save_collection(
        &mut connection,
        collection_request(Some(&group.id), "Review later"),
    )
    .unwrap();
    assert_eq!(renamed.problem_count, 1);
    assert_eq!(renamed.id, group.id);
    let mut memberships = [group.id.as_str(), "default"];
    memberships.sort_unstable();
    assert_eq!(
        personal::memberships(&connection, RANGE_SUMS)
            .unwrap()
            .favorite_ids,
        memberships
    );

    for _ in 0..2 {
        personal::set_membership(&mut connection, "default", RANGE_SUMS, false).unwrap();
    }
    assert!(listed_ids(
        &connection,
        personal_query(PersonalScope::Favorite {
            id: "default".to_owned()
        }),
    )
    .is_empty());
    assert_eq!(
        listed_ids(&connection, personal_query(PersonalScope::Favorites)),
        [RANGE_SUMS]
    );
    personal::delete_collection(&connection, &group.id).unwrap();
    assert!(listed_ids(&connection, personal_query(PersonalScope::Favorites)).is_empty());
    assert_eq!(listed_ids(&connection, ProblemQuery::default()).len(), 2);
}

#[test]
fn personal_favorites_keep_unavailable_and_removed_problems_across_reopens() {
    let (directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    personal::set_membership(&mut connection, "default", PARENTHESIS_DEPTH, true).unwrap();
    let default_favorites = || PersonalScope::Favorite {
        id: "default".to_owned(),
    };
    let favorite_item = |connection: &Connection, scope| {
        let page = query::list_problems(connection, personal_query(scope)).unwrap();
        assert_eq!(page.items.len(), 1);
        serde_json::to_value(&page.items[0]).unwrap()
    };

    db::set_library_status(&mut connection, BASICS, LibraryStatus::Disabled).unwrap();
    assert_eq!(
        favorite_item(&connection, PersonalScope::Favorites)["libraryStatus"],
        "disabled"
    );
    db::set_library_status(&mut connection, BASICS, LibraryStatus::Uninstalled).unwrap();
    let uninstalled = favorite_item(&connection, default_favorites());
    assert_eq!(uninstalled["libraryStatus"], "uninstalled");
    assert_eq!(uninstalled["removed"], false);
    assert!(listed_ids(&connection, ProblemQuery::default()).is_empty());
    install(
        &mut connection,
        single_problem_release(2, true, "Updated statement"),
    )
    .unwrap();
    drop(connection);

    let reopened = db::open(&directory.path().join(db::DATABASE_FILE)).unwrap();
    let removed = favorite_item(&reopened, default_favorites());
    assert_eq!(removed["id"], PARENTHESIS_DEPTH);
    assert_eq!(removed["libraryStatus"], "enabled");
    assert_eq!(removed["removed"], true);
    assert_eq!(removed["contentVersion"], 1);
    assert_eq!(favorite_item(&reopened, PersonalScope::Favorites), removed);
    assert_eq!(listed_ids(&reopened, ProblemQuery::default()), [RANGE_SUMS]);
}

#[test]
fn merges_legacy_favorite_groups_into_default_once_and_keeps_earliest_timestamps() {
    let (directory, mut connection) = test_database();
    install(&mut connection, fixture_files(BASICS)).unwrap();
    install(&mut connection, fixture_files(GRAPHS)).unwrap();
    connection
        .execute_batch(
            "INSERT INTO personal_favorite_groups (id, name) VALUES
             ('to-do', 'To do'), ('mistakes', 'Mistakes'), ('review', 'To review'),
             ('default', 'Default favorites'), ('saved', 'My favorites');
         INSERT INTO favorites (group_id, problem_id, created_at) VALUES
             ('to-do', 'example-basics:demo:1', 25),
             ('mistakes', 'example-basics:demo:1', 30),
             ('review', 'example-basics:demo:1', 15),
             ('default', 'example-basics:demo:1', 40),
             ('review', 'example-basics:demo:2', 9),
             ('default', 'example-basics:demo:2', 2),
             ('review', 'example-graphs:demo:1', 8),
             ('saved', 'example-basics:demo:1', 50);",
        )
        .unwrap();
    drop(connection);

    let path = directory.path().join(db::DATABASE_FILE);
    let mut reopened = db::open(&path).unwrap();
    let groups = personal::list_collections(&reopened).unwrap();
    assert_eq!(
        groups
            .iter()
            .map(|group| (group.id.as_str(), group.problem_count))
            .collect::<Vec<_>>(),
        [("default", 3), ("saved", 1)]
    );
    {
        let mut statement = reopened.prepare(
            "SELECT group_id, problem_id, created_at FROM favorites ORDER BY group_id, problem_id",
        ).unwrap();
        let timestamps = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<(String, String, i64)>>>()
            .unwrap();
        assert_eq!(
            timestamps
                .iter()
                .map(|(group, problem, time)| (group.as_str(), problem.as_str(), *time))
                .collect::<Vec<_>>(),
            [
                ("default", RANGE_SUMS, 15),
                ("default", PARENTHESIS_DEPTH, 2),
                ("default", COMPONENTS, 8),
                ("saved", RANGE_SUMS, 50),
            ]
        );
    }
    let default_favorites = || PersonalScope::Favorite {
        id: "default".to_owned(),
    };
    assert_eq!(
        listed_ids(&reopened, personal_query(default_favorites())),
        [RANGE_SUMS, PARENTHESIS_DEPTH, COMPONENTS]
    );
    for _ in 0..2 {
        personal::set_membership(&mut reopened, "default", RANGE_SUMS, false).unwrap();
    }
    assert_eq!(
        personal::set_membership(&mut reopened, "review", RANGE_SUMS, true)
            .unwrap_err()
            .code,
        "personal_not_found"
    );
    drop(reopened);

    let reopened = db::open(&path).unwrap();
    assert_eq!(
        listed_ids(&reopened, personal_query(default_favorites())),
        [PARENTHESIS_DEPTH, COMPONENTS]
    );
    assert_eq!(
        personal::memberships(&reopened, RANGE_SUMS)
            .unwrap()
            .favorite_ids,
        ["saved"]
    );
}
