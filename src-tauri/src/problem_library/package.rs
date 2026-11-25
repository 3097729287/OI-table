use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{LibraryError, Result};

pub(super) const MANIFEST_PATH: &str = "manifest.json";
pub(super) const MAX_PACKAGE_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_PACKAGE_FILES: usize = 32_768;
pub(super) const MAX_IMPORT_BYTES: usize = 128 * 1024 * 1024;
pub(super) const MAX_IMPORT_FILES: usize = MAX_PACKAGE_FILES * 4;
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

pub(super) struct PackageFile {
    pub(super) path: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LocalizedText {
    #[serde(rename = "zhCN")]
    pub(super) zh_cn: Option<String>,
    pub(super) en: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Archive {
    pub(super) id: String,
    pub(super) parent_id: Option<String>,
    pub(super) name: LocalizedText,
    #[serde(default)]
    pub(super) sort_order: i32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Tag {
    pub(super) id: String,
    pub(super) name: LocalizedText,
}

#[derive(Debug, Serialize)]
pub(super) struct Solution {
    pub(super) id: String,
    pub(super) title: LocalizedText,
    pub(super) body: LocalizedText,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Problem {
    pub(super) id: String,
    pub(super) author_id: String,
    pub(super) sequence: i64,
    pub(super) author_name: Option<LocalizedText>,
    pub(super) rating: Option<u32>,
    pub(super) archive_id: Option<String>,
    pub(super) title: LocalizedText,
    pub(super) statement: LocalizedText,
    pub(super) tags: Vec<String>,
    pub(super) solutions: Vec<Solution>,
    #[serde(skip)]
    pub(super) hash: String,
}

#[derive(Debug)]
pub(super) struct Package {
    pub(super) library_id: String,
    pub(super) name: LocalizedText,
    pub(super) author_id: String,
    pub(super) author_name: Option<LocalizedText>,
    pub(super) release_version: i64,
    pub(super) complete: bool,
    pub(super) archives: Vec<Archive>,
    pub(super) tags: Vec<Tag>,
    pub(super) problems: Vec<Problem>,
    pub(super) hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format_version: u32,
    library_id: String,
    name: LocalizedText,
    author_id: String,
    author_name: Option<LocalizedText>,
    release_version: i64,
    complete: bool,
    #[serde(default)]
    archives: Vec<Archive>,
    #[serde(default)]
    tags: Vec<Tag>,
    problems: Vec<ProblemInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProblemInput {
    sequence: i64,
    folder: Option<String>,
    rating: Option<u32>,
    archive_id: Option<String>,
    title: LocalizedText,
    statement: Option<LocalizedText>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    solutions: Vec<SolutionInput>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SolutionInput {
    id: String,
    title: LocalizedText,
    body: Option<LocalizedText>,
}

struct MarkdownFile {
    text: String,
    used: bool,
}

struct MarkdownFiles {
    files: HashMap<String, MarkdownFile>,
    remaining_bytes: usize,
}

pub(super) struct PackageLayout {
    package_count: usize,
    locations: Vec<Option<PackageFileLocation>>,
}

#[derive(Clone, Copy)]
pub(super) struct PackageFileLocation {
    pub(super) package: usize,
    pub(super) start: usize,
}

impl PackageLayout {
    pub(super) fn package_count(&self) -> usize {
        self.package_count
    }

    pub(super) fn locations(&self) -> &[Option<PackageFileLocation>] {
        &self.locations
    }
}

pub(super) fn locate_package_files<'a>(
    paths: impl Iterator<Item = &'a str>,
) -> Result<PackageLayout> {
    let mut sorted = Vec::new();
    for (index, path) in paths.enumerate() {
        if index == MAX_IMPORT_FILES {
            return Err(import_too_large());
        }
        validate_path(path)?;
        sorted.push((path.to_lowercase(), index, path));
    }
    sorted.sort_unstable();
    for pair in sorted.windows(2) {
        if pair[0].0 == pair[1].0 {
            return Err(LibraryError::invalid(format!(
                "Duplicate package path {}",
                pair[1].2
            )));
        }
    }
    for (normalized, _, path) in &sorted {
        let prefix = format!("{normalized}/");
        let start = sorted.partition_point(|(candidate, _, _)| candidate < &prefix);
        if sorted
            .get(start)
            .is_some_and(|(candidate, _, _)| candidate.starts_with(&prefix))
        {
            return Err(LibraryError::invalid(format!(
                "Package path {path} is both a file and a directory"
            )));
        }
    }

    // A manifest at the selected root retains the strict single-package layout.
    if sorted.iter().any(|&(_, _, path)| path == MANIFEST_PATH) {
        return Ok(PackageLayout {
            package_count: 1,
            locations: vec![
                Some(PackageFileLocation {
                    package: 0,
                    start: 0
                });
                sorted.len()
            ],
        });
    }

    let mut locations = vec![None; sorted.len()];
    let mut package_count = 0;
    let mut previous_end = 0;
    for (normalized, _, path) in &sorted {
        let Some((parent, name)) = path.rsplit_once('/') else {
            continue;
        };
        if name != MANIFEST_PATH {
            continue;
        }
        let root = &path[..parent.len() + 1];
        let normalized_root = &normalized[..normalized.len() - MANIFEST_PATH.len()];
        let start =
            sorted.partition_point(|(candidate, _, _)| candidate.as_str() < normalized_root);
        if start < previous_end {
            return Err(LibraryError::invalid(format!(
                "Problem library package roots overlap at {path}"
            )));
        }
        previous_end = start;
        for (candidate, index, path) in &sorted[start..] {
            if !candidate.starts_with(normalized_root) {
                break;
            }
            if !path.starts_with(root) {
                return Err(LibraryError::invalid(format!(
                    "Package path {path} does not match the case of its package root {root}"
                )));
            }
            locations[*index] = Some(PackageFileLocation {
                package: package_count,
                start: root.len(),
            });
            previous_end += 1;
        }
        package_count += 1;
    }
    if package_count == 0 {
        return Err(LibraryError::new(
            "missing_manifest",
            "The selected import does not contain manifest.json",
        ));
    }
    Ok(PackageLayout {
        package_count,
        locations,
    })
}

pub(super) fn read_packages(files: Vec<PackageFile>) -> Result<Vec<Package>> {
    let mut remaining_bytes = MAX_IMPORT_BYTES;
    for file in &files {
        remaining_bytes = remaining_bytes
            .checked_sub(file.path.len().saturating_add(file.text.len()))
            .ok_or_else(import_too_large)?;
    }
    let layout = locate_package_files(files.iter().map(|file| file.path.as_str()))?;
    let mut groups: Vec<Vec<_>> = (0..layout.package_count()).map(|_| Vec::new()).collect();
    for (mut file, location) in files.into_iter().zip(layout.locations) {
        if let Some(location) = location {
            file.path.drain(..location.start);
            groups[location.package].push(file);
        }
    }

    let mut ids = HashSet::new();
    let mut packages = Vec::with_capacity(groups.len());
    for group in groups {
        let package = read_package(group)?;
        if !ids.insert(package.library_id.clone()) {
            return Err(LibraryError::invalid(format!(
                "Duplicate library ID {}",
                package.library_id
            )));
        }
        packages.push(package);
    }
    Ok(packages)
}

pub(super) fn import_too_large() -> LibraryError {
    LibraryError::new(
        "package_too_large",
        "The import exceeds 128 MiB or 131072 files",
    )
}

pub(super) fn read_package(files: Vec<PackageFile>) -> Result<Package> {
    let (mut manifest, mut markdown) = read_files(files)?;
    if manifest.format_version != 1 {
        return Err(LibraryError::invalid("Unsupported problem library format"));
    }
    validate_segment(&manifest.library_id, "libraryId")?;
    validate_segment(&manifest.author_id, "authorId")?;
    validate_counter(manifest.release_version, "releaseVersion")?;
    manifest.name.normalize_label("Library name")?;
    if let Some(name) = &mut manifest.author_name {
        name.normalize_label("Organizer name")?;
    }

    for archive in &mut manifest.archives {
        validate_segment(&archive.id, "Archive ID")?;
        archive
            .name
            .normalize_label(&format!("Name for archive {}", archive.id))?;
    }
    manifest.archives.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let archive_ids = unique_ids("archive", manifest.archives.iter().map(|a| a.id.as_str()))?;
    validate_archive_parents(&manifest.archives)?;

    for tag in &mut manifest.tags {
        validate_segment(&tag.id, "Tag ID")?;
        tag.name
            .normalize_label(&format!("Name for tag {}", tag.id))?;
    }
    manifest.tags.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let tag_ids = unique_ids("tag", manifest.tags.iter().map(|t| t.id.as_str()))?;

    let mut seen_sequences = HashSet::new();
    let mut problems = Vec::with_capacity(manifest.problems.len());
    for input in manifest.problems {
        validate_counter(input.sequence, "Problem sequence")?;
        let id = format!(
            "{}:{}:{}",
            manifest.library_id, manifest.author_id, input.sequence
        );
        if !seen_sequences.insert(input.sequence) {
            return Err(LibraryError::invalid(format!("Duplicate problem ID {id}")));
        }
        problems.push(validate_problem(
            id,
            input,
            manifest.author_id.clone(),
            manifest.author_name.clone(),
            &archive_ids,
            &tag_ids,
            &mut markdown,
        )?);
    }
    problems.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    if let Some(unused) = markdown.unused_path() {
        return Err(LibraryError::invalid(format!(
            "Unreferenced package file {unused}"
        )));
    }

    // Problem hashes include the resolved Markdown. The manifest hash composes them with
    // the release metadata and taxonomy, so filenames and input array order do not affect it.
    let problem_hashes: Vec<_> = problems.iter().map(|p| (&p.id, &p.hash)).collect();
    let hash = hash_canonical(
        b"oi-table/library-manifest/v1\0",
        &(
            manifest.format_version,
            &manifest.library_id,
            &manifest.name,
            &manifest.author_id,
            &manifest.author_name,
            manifest.release_version,
            manifest.complete,
            &manifest.archives,
            &manifest.tags,
            &problem_hashes,
        ),
    )?;
    Ok(Package {
        library_id: manifest.library_id,
        name: manifest.name,
        author_id: manifest.author_id,
        author_name: manifest.author_name,
        release_version: manifest.release_version,
        complete: manifest.complete,
        archives: manifest.archives,
        tags: manifest.tags,
        problems,
        hash,
    })
}

fn read_files(files: Vec<PackageFile>) -> Result<(Manifest, MarkdownFiles)> {
    if files.len() > MAX_PACKAGE_FILES {
        return Err(LibraryError::invalid(
            "Too many files in the problem library package",
        ));
    }
    let mut paths = HashSet::new();
    let mut manifest = None;
    let mut documents = HashMap::new();
    let mut remaining_bytes = MAX_PACKAGE_BYTES;
    for PackageFile { path, text } in files {
        let size = path.len().saturating_add(text.len());
        remaining_bytes = remaining_bytes
            .checked_sub(size)
            .ok_or_else(package_too_large)?;
        validate_path(&path)?;
        if !paths.insert(path.to_lowercase()) {
            return Err(LibraryError::invalid(format!(
                "Duplicate package path {path}"
            )));
        }
        if path == MANIFEST_PATH {
            manifest = Some(text);
        } else if path.ends_with(".md") {
            documents.insert(path, MarkdownFile { text, used: false });
        } else {
            return Err(LibraryError::invalid(format!(
                "Unexpected package file {path}"
            )));
        }
    }
    let manifest =
        manifest.ok_or_else(|| LibraryError::invalid("The package is missing manifest.json"))?;
    let manifest = serde_json::from_str(strip_bom(&manifest))
        .map_err(|error| LibraryError::invalid(format!("manifest.json: {error}")))?;
    Ok((
        manifest,
        MarkdownFiles {
            files: documents,
            remaining_bytes: MAX_PACKAGE_BYTES,
        },
    ))
}

pub(super) fn validate_path(path: &str) -> Result<()> {
    // Resolve against the submitted file list, independent of the host filesystem.
    if path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | "..") || part.ends_with(['.', ' ']))
    {
        return Err(LibraryError::invalid(format!(
            "Invalid package path {path:?}"
        )));
    }
    Ok(())
}

fn validate_problem(
    id: String,
    mut input: ProblemInput,
    author_id: String,
    author_name: Option<LocalizedText>,
    archive_ids: &HashSet<&str>,
    tag_ids: &HashSet<&str>,
    markdown: &mut MarkdownFiles,
) -> Result<Problem> {
    if let Some(archive_id) = &input.archive_id {
        if !archive_ids.contains(archive_id.as_str()) {
            return Err(LibraryError::invalid(format!(
                "Problem {id} refers to unknown archive {archive_id}"
            )));
        }
    }
    let folder = input.folder.as_deref();
    if let Some(folder) = folder {
        validate_path(folder)?;
    }
    input.title.normalize_label(&format!("Title for {id}"))?;
    let statement = markdown.resolve(
        input.statement,
        &input.title,
        folder,
        "statement",
        &format!("Statement for {id}"),
    )?;

    let mut tags = input.tags;
    tags.sort_unstable();
    unique_ids("problem tag", tags.iter().map(String::as_str))?;
    for tag in &tags {
        if !tag_ids.contains(tag.as_str()) {
            return Err(LibraryError::invalid(format!(
                "Problem {id} refers to unknown tag {tag}"
            )));
        }
    }

    input.solutions.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    unique_ids("solution", input.solutions.iter().map(|s| s.id.as_str()))?;
    let single_solution = input.solutions.len() == 1;
    let mut solutions = Vec::with_capacity(input.solutions.len());
    for mut solution in input.solutions {
        validate_segment(&solution.id, "Solution ID")?;
        solution
            .title
            .normalize_label(&format!("Title for solution {} of {id}", solution.id))?;
        let default_stem = if single_solution {
            "solution".to_owned()
        } else {
            format!("solutions/{}", solution.id)
        };
        let body = markdown.resolve(
            solution.body,
            &solution.title,
            folder,
            &default_stem,
            &format!("Solution {} for {id}", solution.id),
        )?;
        solutions.push(Solution {
            id: solution.id,
            title: solution.title,
            body,
        });
    }

    let mut problem = Problem {
        author_id,
        sequence: input.sequence,
        author_name,
        rating: input.rating,
        archive_id: input.archive_id,
        title: input.title,
        statement,
        id,
        tags,
        solutions,
        hash: String::new(),
    };
    problem.hash = hash_canonical(b"oi-table/library-problem/v1\0", &problem)?;
    Ok(problem)
}

fn unique_ids<'a>(kind: &str, ids: impl Iterator<Item = &'a str>) -> Result<HashSet<&'a str>> {
    let mut unique = HashSet::new();
    for id in ids {
        if !unique.insert(id) {
            return Err(LibraryError::invalid(format!("Duplicate {kind} ID {id}")));
        }
    }
    Ok(unique)
}

fn validate_archive_parents(archives: &[Archive]) -> Result<()> {
    let parents: HashMap<_, _> = archives
        .iter()
        .map(|archive| (archive.id.as_str(), archive.parent_id.as_deref()))
        .collect();
    let mut visited = HashMap::new();
    for archive in archives {
        let start = archive.id.as_str();
        let mut current = Some(start);
        while let Some(id) = current {
            if let Some(&previous) = visited.get(id) {
                if previous == start {
                    return Err(LibraryError::invalid(format!(
                        "Archive parent cycle includes {id}"
                    )));
                }
                break;
            }
            visited.insert(id, start);
            current = *parents.get(id).ok_or_else(|| {
                LibraryError::invalid(format!(
                    "Archive {} refers to unknown parent {id}",
                    archive.id
                ))
            })?;
        }
    }
    Ok(())
}

pub(super) fn validate_segment(value: &str, field: &str) -> Result<()> {
    let mut bytes = value.bytes();
    let is_alphanumeric = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if value.len() > 64
        || !bytes.next().is_some_and(is_alphanumeric)
        || !bytes.all(|byte| is_alphanumeric(byte) || matches!(byte, b'-' | b'_'))
    {
        return Err(LibraryError::invalid(format!("Invalid {field} {value:?}")));
    }
    Ok(())
}

fn validate_counter(value: i64, field: &str) -> Result<()> {
    if !(1..=MAX_SAFE_INTEGER).contains(&value) {
        return Err(LibraryError::invalid(format!(
            "{field} must be a positive safe integer"
        )));
    }
    Ok(())
}

impl MarkdownFiles {
    fn resolve(
        &mut self,
        paths: Option<LocalizedText>,
        title: &LocalizedText,
        folder: Option<&str>,
        default_stem: &str,
        field: &str,
    ) -> Result<LocalizedText> {
        let mut paths = match paths {
            Some(paths) => paths,
            None => {
                let folder = folder.ok_or_else(|| {
                    LibraryError::invalid(format!(
                        "{field} needs a problem folder for default paths"
                    ))
                })?;
                LocalizedText {
                    zh_cn: title
                        .zh_cn
                        .as_ref()
                        .map(|_| format!("{folder}/{default_stem}.zh-cn.md")),
                    en: title
                        .en
                        .as_ref()
                        .map(|_| format!("{folder}/{default_stem}.en.md")),
                }
            }
        };
        title.require_matching_languages(&paths, field)?;
        paths.require_content(field)?;
        for path in [&mut paths.zh_cn, &mut paths.en].into_iter().flatten() {
            *path = self.read(path)?;
        }
        Ok(paths)
    }

    fn read(&mut self, path: &str) -> Result<String> {
        validate_path(path)?;
        let file = self
            .files
            .get_mut(path)
            .ok_or_else(|| LibraryError::invalid(format!("Missing Markdown file {path}")))?;
        self.remaining_bytes = self
            .remaining_bytes
            .checked_sub(file.text.len())
            .ok_or_else(package_too_large)?;
        let text = strip_bom(&file.text);
        if text.trim().is_empty() {
            return Err(LibraryError::invalid(format!(
                "Markdown file {path} is empty"
            )));
        }
        file.used = true;
        Ok(text.replace("\r\n", "\n").replace('\r', "\n"))
    }

    fn unused_path(&self) -> Option<&str> {
        self.files
            .iter()
            .filter(|(_, file)| !file.used)
            .map(|(path, _)| path.as_str())
            .min()
    }
}

impl LocalizedText {
    fn require_content(&self, field: &str) -> Result<()> {
        if self.zh_cn.is_none() && self.en.is_none()
            || [&self.zh_cn, &self.en]
                .into_iter()
                .flatten()
                .any(|value| value.trim().is_empty())
        {
            return Err(LibraryError::invalid(format!("{field} needs at least one translation and each supplied translation must have content")));
        }
        Ok(())
    }

    fn normalize_label(&mut self, field: &str) -> Result<()> {
        self.require_content(field)?;
        for label in [&mut self.zh_cn, &mut self.en].into_iter().flatten() {
            *label = label.trim().to_owned();
        }
        Ok(())
    }

    fn require_matching_languages(&self, other: &Self, field: &str) -> Result<()> {
        if self.zh_cn.is_some() != other.zh_cn.is_some() || self.en.is_some() != other.en.is_some()
        {
            return Err(LibraryError::invalid(format!(
                "{field} must provide translations in the same languages"
            )));
        }
        Ok(())
    }
}

fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

fn package_too_large() -> LibraryError {
    LibraryError::invalid("Problem library packages must fit within 32 MiB")
}

fn hash_canonical(domain: &[u8], value: &impl Serialize) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    serde_json::to_writer(&mut hasher, value)
        .map_err(|error| LibraryError::invalid(format!("Cannot hash package contents: {error}")))?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    fn manifest() -> Value {
        json!({
            "formatVersion": 1,
            "libraryId": "examples",
            "name": { "en": "Examples" },
            "authorId": "editor",
            "authorName": { "en": "Example Organizer" },
            "releaseVersion": 1,
            "complete": true,
            "tags": [
                { "id": "arrays", "name": { "en": "Arrays" } },
                { "id": "ordering", "name": { "en": "Ordering" } }
            ],
            "archives": [
                { "id": "parent", "name": { "en": "Parent" } },
                { "id": "child", "name": { "en": "Child" }, "parentId": "parent" }
            ],
            "problems": [{
                "sequence": 1,
                "title": { "en": "Sort numbers" },
                "statement": { "en": "sort/statement.md" },
                "archiveId": "child",
                "tags": ["ordering", "arrays"],
                "solutions": [{
                    "id": "sort",
                    "title": { "en": "Sorting" },
                    "body": { "en": "sort/solution.md" }
                }]
            }]
        })
    }

    fn parse(manifest: &Value, markdown: &[(&str, &str)]) -> Result<Package> {
        let mut files = vec![PackageFile {
            path: MANIFEST_PATH.to_owned(),
            text: manifest.to_string(),
        }];
        files.extend(markdown.iter().map(|&(path, text)| PackageFile {
            path: path.to_owned(),
            text: text.to_owned(),
        }));
        read_package(files)
    }

    const DOCUMENTS: &[(&str, &str)] = &[
        ("sort/statement.md", "Sort numbers.\nReturn the result.\n"),
        ("sort/solution.md", "Use a sorting algorithm.\n"),
    ];

    fn files_under(root: &str, id: &str) -> Vec<PackageFile> {
        let mut manifest = manifest();
        manifest["libraryId"] = json!(id);
        let mut files = vec![PackageFile {
            path: format!("{root}{MANIFEST_PATH}"),
            text: manifest.to_string(),
        }];
        files.extend(DOCUMENTS.iter().map(|&(path, text)| PackageFile {
            path: format!("{root}{path}"),
            text: text.to_owned(),
        }));
        files
    }

    #[test]
    fn reads_separate_libraries_under_wrappers_in_root_order() {
        let mut files = files_under("bundle/z/library/", "second");
        files.extend(files_under("bundle/a/", "first"));
        files.push(PackageFile {
            path: "bundle/README.txt".to_owned(),
            text: "Sample packages".to_owned(),
        });
        files.reverse();

        let packages = read_packages(files).unwrap();
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].library_id, "first");
        assert_eq!(packages[1].library_id, "second");
        assert_eq!(
            packages[1].problems[0].statement.en.as_deref(),
            Some(DOCUMENTS[0].1)
        );
    }

    #[test]
    fn keeps_the_root_manifest_package_strict() {
        let mut files = files_under("", "root");
        files.extend(files_under("nested/", "child"));
        let error = read_packages(files).unwrap_err();
        assert!(error
            .message
            .contains("Unexpected package file nested/manifest.json"));
    }

    #[test]
    fn rejects_overlapping_roots_and_duplicate_library_ids() {
        let mut nested = files_under("bundle/parent/alpha/", "child");
        nested.extend(files_under("bundle/parent/", "parent"));
        assert!(read_packages(nested)
            .unwrap_err()
            .message
            .contains("roots overlap"));

        let mut duplicates = files_under("first/", "shared");
        duplicates.extend(files_under("second/", "shared"));
        assert!(read_packages(duplicates)
            .unwrap_err()
            .message
            .contains("Duplicate library ID shared"));
    }

    #[test]
    fn validates_ambiguous_paths_even_outside_package_roots() {
        let mut files = files_under("bundle/library/", "library");
        files.push(PackageFile {
            path: "BUNDLE/LIBRARY".to_owned(),
            text: String::new(),
        });
        assert!(read_packages(files)
            .unwrap_err()
            .message
            .contains("both a file and a directory"));

        let mut files = files_under("bundle/library/", "library");
        files.push(PackageFile {
            path: "bundle/LIBRARY/other.md".to_owned(),
            text: String::new(),
        });
        assert!(read_packages(files)
            .unwrap_err()
            .message
            .contains("does not match the case"));
    }

    #[test]
    fn canonical_hashes_follow_resolved_content() {
        let original = parse(&manifest(), DOCUMENTS).unwrap();
        let mut reorganized = manifest();
        reorganized["tags"].as_array_mut().unwrap().reverse();
        reorganized["archives"].as_array_mut().unwrap().reverse();
        reorganized["problems"][0]["tags"]
            .as_array_mut()
            .unwrap()
            .reverse();
        reorganized["problems"][0]["statement"]["en"] = json!("renamed.md");
        let mut markdown = [
            DOCUMENTS[1],
            (
                "renamed.md",
                "\u{feff}Sort numbers.\r\nReturn the result.\r",
            ),
        ];
        let equivalent = parse(&reorganized, &markdown).unwrap();
        assert_eq!(original.hash, equivalent.hash);
        assert_eq!(original.problems[0].hash, equivalent.problems[0].hash);

        markdown[0].1 = "Use counting sort.\n";
        let updated = parse(&reorganized, &markdown).unwrap();
        assert_eq!(original.problems[0].id, updated.problems[0].id);
        assert_ne!(original.problems[0].hash, updated.problems[0].hash);
        assert_ne!(original.hash, updated.hash);
    }

    #[test]
    fn omitted_paths_resolve_the_same_content_as_explicit_paths() {
        let explicit = parse(&manifest(), DOCUMENTS).unwrap();
        let mut defaults = manifest();
        let problem = defaults["problems"][0].as_object_mut().unwrap();
        problem.remove("statement");
        problem.insert("folder".to_owned(), json!("sort"));
        problem["solutions"][0]
            .as_object_mut()
            .unwrap()
            .remove("body");
        let documents = [
            ("sort/statement.en.md", DOCUMENTS[0].1),
            ("sort/solution.en.md", DOCUMENTS[1].1),
        ];

        let inferred = parse(&defaults, &documents).unwrap();
        assert_eq!(explicit.hash, inferred.hash);
        assert_eq!(explicit.problems[0].hash, inferred.problems[0].hash);

        assert!(parse(&defaults, &documents[..1])
            .unwrap_err()
            .message
            .contains("Missing Markdown file sort/solution.en.md"));
        defaults["problems"][0]
            .as_object_mut()
            .unwrap()
            .remove("folder");
        assert!(parse(&defaults, &documents)
            .unwrap_err()
            .message
            .contains("needs a problem folder"));
    }

    #[test]
    fn uses_solution_ids_for_defaults_and_keeps_explicit_paths_root_relative() {
        let mut input = manifest();
        let problem = &mut input["problems"][0];
        problem["folder"] = json!("sort");
        problem["solutions"][0]["body"]["en"] = json!("shared/custom.md");
        problem["solutions"].as_array_mut().unwrap().push(json!({
            "id": "counting",
            "title": { "en": "Counting sort" }
        }));

        let resolved = parse(
            &input,
            &[
                DOCUMENTS[0],
                ("shared/custom.md", DOCUMENTS[1].1),
                ("sort/solutions/counting.en.md", "Count the values.\n"),
            ],
        )
        .unwrap();
        let solutions = &resolved.problems[0].solutions;
        assert_eq!(solutions[0].body.en.as_deref(), Some("Count the values.\n"));
        assert_eq!(solutions[1].body.en.as_deref(), Some(DOCUMENTS[1].1));
    }

    #[test]
    fn requires_the_organizer_at_the_manifest_root() {
        let mut missing = manifest();
        missing.as_object_mut().unwrap().remove("authorId");
        assert!(parse(&missing, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("missing field `authorId`"));

        for field in ["authorId", "authorName", "executionPoint"] {
            let mut invalid = manifest();
            invalid["problems"][0][field] = json!("unexpected");
            assert!(parse(&invalid, DOCUMENTS)
                .unwrap_err()
                .message
                .contains(&format!("unknown field `{field}`")));
        }
    }

    #[test]
    fn rejects_duplicate_ids_and_archive_cycles() {
        let mut duplicate = manifest();
        let problem = duplicate["problems"][0].clone();
        duplicate["problems"].as_array_mut().unwrap().push(problem);
        assert!(parse(&duplicate, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("Duplicate problem ID"));

        let mut cycle = manifest();
        cycle["archives"][0]["parentId"] = json!("child");
        assert!(parse(&cycle, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("Archive parent cycle"));
    }

    #[test]
    fn resolves_only_safe_submitted_paths() {
        let mut traversal = manifest();
        traversal["problems"][0]["statement"]["en"] = json!("sort/../../outside.md");
        assert!(parse(&traversal, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("Invalid package path"));

        let mut traversal = manifest();
        traversal["problems"][0]["folder"] = json!("sort/..");
        assert!(parse(&traversal, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("Invalid package path"));

        let case_alias = [DOCUMENTS[0], DOCUMENTS[1], ("Sort/statement.md", "Other")];
        assert!(parse(&manifest(), &case_alias)
            .unwrap_err()
            .message
            .contains("Duplicate package path"));
    }

    #[test]
    fn rejects_unpaired_problem_and_solution_languages() {
        let mut mismatched = manifest();
        mismatched["problems"][0]["title"]["zhCN"] = json!("排序");
        assert!(parse(&mismatched, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("same languages"));

        let mut mismatched = manifest();
        mismatched["problems"][0]["solutions"][0]["title"]["zhCN"] = json!("排序算法");
        assert!(parse(&mismatched, DOCUMENTS)
            .unwrap_err()
            .message
            .contains("same languages"));
    }
}
