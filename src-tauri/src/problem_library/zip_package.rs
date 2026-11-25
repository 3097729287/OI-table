use std::collections::BTreeMap;
use std::fmt::Display;
use std::fs::File;
use std::io::{Cursor, Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use super::package::{
    locate_package_files, read_packages, validate_path, Package, PackageFile, MANIFEST_PATH,
    MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES,
};
use super::{LibraryError, Result};

const UNIX_FILE_TYPE: u32 = 0o170000;
const UNIX_DIRECTORY: u32 = 0o040000;
const UNIX_REGULAR_FILE: u32 = 0o100000;
const DOS_DIRECTORY: u32 = 0x10;
const DOS_REPARSE_POINT: u32 = 0x400;

struct Member {
    index: usize,
    path: String,
    size: u64,
}

pub(super) fn read_zip(path: &Path) -> Result<Vec<Package>> {
    let file = File::open(path).map_err(invalid_zip)?;
    let metadata = file.metadata().map_err(invalid_zip)?;
    if !metadata.is_file() {
        return Err(invalid_zip("Expected a regular ZIP file"));
    }
    if metadata.len() > MAX_IMPORT_BYTES as u64 {
        return Err(import_too_large());
    }

    // Read a bounded snapshot so all later ZIP seeks use the same bytes.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_IMPORT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(invalid_zip)?;
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(import_too_large());
    }
    read_archive(Cursor::new(bytes))
}

fn read_archive(reader: impl Read + Seek) -> Result<Vec<Package>> {
    let mut archive = ZipArchive::new(reader).map_err(invalid_zip)?;
    let members = inspect_members(&archive)?;
    archive.validate_header_consistency().map_err(invalid_zip)?;
    let layout = locate_package_files(members.iter().map(|member| member.path.as_str()))?;
    let mut budgets = vec![(MAX_PACKAGE_FILES, MAX_PACKAGE_BYTES as u64); layout.package_count()];
    let mut files = Vec::with_capacity(members.len());

    for (member, location) in members.into_iter().zip(layout.locations()) {
        let text = if let Some(location) = location {
            let relative_path = &member.path[location.start..];
            if relative_path != MANIFEST_PATH && !relative_path.ends_with(".md") {
                return Err(LibraryError::invalid(format!(
                    "Unexpected package file {relative_path}"
                )));
            }
            let (files_left, bytes_left) = &mut budgets[location.package];
            *files_left = files_left.checked_sub(1).ok_or_else(package_too_large)?;
            *bytes_left = bytes_left
                .checked_sub(member.size + relative_path.len() as u64)
                .ok_or_else(package_too_large)?;
            read_text(&mut archive, &member)?
        } else {
            String::new()
        };
        files.push(PackageFile {
            path: member.path,
            text,
        });
    }
    read_packages(files)
}

fn inspect_members(archive: &ZipArchive<impl Read + Seek>) -> Result<Vec<Member>> {
    if archive.has_duplicate_names() {
        return Err(invalid_zip("The ZIP contains duplicate paths"));
    }
    if archive.len() > MAX_IMPORT_FILES {
        return Err(import_too_large());
    }

    let mut paths = BTreeMap::new();
    let mut members = Vec::new();
    let mut bytes_left = MAX_IMPORT_BYTES as u64;
    for index in 0..archive.len() {
        let entry = archive.by_index_data(index).map_err(invalid_zip)?;
        let name = entry.name().map_err(|error| {
            LibraryError::new(
                "package_encoding",
                format!("Invalid ZIP filename ({error})"),
            )
        })?;
        let path = name.strip_suffix('/').unwrap_or(&name);
        validate_path(path)?;

        let attributes = entry.external_attributes();
        let file_type = entry.unix_mode().unwrap_or(0) & UNIX_FILE_TYPE;
        let directory = path.len() != name.len()
            || file_type == UNIX_DIRECTORY
            || attributes & DOS_DIRECTORY != 0;
        if attributes & DOS_REPARSE_POINT != 0
            || !matches!(file_type, 0 | UNIX_REGULAR_FILE | UNIX_DIRECTORY)
            || (directory && entry.size() != 0)
        {
            return Err(invalid_zip(format!(
                "ZIP entry {name:?} is not a regular file or directory"
            )));
        }
        bytes_left = bytes_left
            .checked_sub(path.len() as u64)
            .and_then(|remaining| remaining.checked_sub(entry.size()))
            .ok_or_else(import_too_large)?;
        if paths.insert(path.to_lowercase(), directory).is_some() {
            return Err(invalid_zip(format!("Duplicate ZIP path {path:?}")));
        }
        if !directory {
            members.push(Member {
                index,
                path: path.to_owned(),
                size: entry.size(),
            });
        }
    }

    for (path, directory) in &paths {
        if !directory {
            let prefix = format!("{path}/");
            if paths
                .range(prefix.clone()..)
                .next()
                .is_some_and(|(child, _)| child.starts_with(&prefix))
            {
                return Err(invalid_zip(format!(
                    "ZIP file {path:?} is also used as a directory"
                )));
            }
        }
    }
    Ok(members)
}

fn read_text(archive: &mut ZipArchive<impl Read + Seek>, member: &Member) -> Result<String> {
    let mut bytes = Vec::new();
    archive
        .by_index(member.index)
        .map_err(invalid_zip)?
        .take(member.size + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            invalid_zip(format!(
                "Could not read ZIP entry {:?} ({error})",
                member.path
            ))
        })?;
    if bytes.len() as u64 != member.size {
        return Err(invalid_zip(format!(
            "Incorrect size for ZIP entry {:?}",
            member.path
        )));
    }
    String::from_utf8(bytes).map_err(|_| {
        LibraryError::new(
            "package_encoding",
            format!("ZIP entry {:?} is not UTF-8", member.path),
        )
    })
}

fn invalid_zip(error: impl Display) -> LibraryError {
    LibraryError::new("invalid_zip", error.to_string())
}

fn import_too_large() -> LibraryError {
    LibraryError::new(
        "package_too_large",
        "The ZIP exceeds 128 MiB or 131072 entries",
    )
}

fn package_too_large() -> LibraryError {
    LibraryError::new(
        "package_too_large",
        "An individual package exceeds 32 MiB or 32768 files",
    )
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::*;

    fn manifest(id: &str) -> String {
        serde_json::json!({
            "formatVersion": 1,
            "libraryId": id,
            "name": { "en": id },
            "authorId": "editor",
            "releaseVersion": 1,
            "complete": true,
            "problems": [{
                "sequence": 1,
                "folder": "problems",
                "title": { "en": "An example" }
            }]
        })
        .to_string()
    }

    fn add_file<W: Write + Seek>(zip: &mut ZipWriter<W>, name: &str, contents: &[u8]) {
        zip.start_file(
            name,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(contents).unwrap();
    }

    fn add_library<W: Write + Seek>(zip: &mut ZipWriter<W>, prefix: &str, id: &str) {
        add_file(
            zip,
            &format!("{prefix}manifest.json"),
            manifest(id).as_bytes(),
        );
        add_file(
            zip,
            &format!("{prefix}problems/statement.en.md"),
            b"Solve it.\n",
        );
    }

    #[test]
    fn reads_deflated_root_package_from_a_zip_file() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = ZipWriter::new(file.reopen().unwrap());
        add_library(&mut zip, "", "standalone");
        zip.finish().unwrap();

        let packages = read_zip(file.path()).unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].library_id, "standalone");
        assert_eq!(
            packages[0].problems[0].statement.en.as_deref(),
            Some("Solve it.\n")
        );
    }

    #[test]
    fn reads_wrapped_packages_with_unrelated_files() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.add_directory("包装", SimpleFileOptions::default())
            .unwrap();
        add_library(&mut zip, "包装/one/", "one");
        add_library(&mut zip, "包装/nested/two/", "two");
        add_file(&mut zip, "包装/._one.md", b"\xff");
        let packages = read_archive(zip.finish().unwrap()).unwrap();

        let mut ids: Vec<_> = packages
            .iter()
            .map(|package| package.library_id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, ["one", "two"]);
    }

    #[test]
    fn rejects_a_symlink_member() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.add_symlink("manifest.json", "other.json", SimpleFileOptions::default())
            .unwrap();
        assert_eq!(
            read_archive(zip.finish().unwrap()).unwrap_err().code,
            "invalid_zip"
        );
    }

    #[test]
    fn rejects_a_case_alias() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        add_library(&mut zip, "", "standalone");
        add_file(&mut zip, "problems/Statement.en.md", b"Duplicate.");
        assert_eq!(
            read_archive(zip.finish().unwrap()).unwrap_err().code,
            "invalid_zip"
        );
    }

    #[test]
    fn rejects_an_invalid_package_text_encoding() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        add_file(&mut zip, "manifest.json", manifest("standalone").as_bytes());
        add_file(&mut zip, "problems/statement.en.md", b"\xff");
        assert_eq!(
            read_archive(zip.finish().unwrap()).unwrap_err().code,
            "package_encoding"
        );
    }
}
