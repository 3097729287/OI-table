use std::fmt::Display;
use std::fs::{self, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use super::package::{
    import_too_large, locate_package_files, read_packages, validate_path, Package, PackageFile,
    MANIFEST_PATH, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES,
};
use super::{LibraryError, Result};

pub(super) fn read_directory(root: &Path) -> Result<Vec<Package>> {
    let root: PathBuf = root.components().collect();
    let mut pending = vec![PathBuf::new()];
    let mut pending_path_bytes = 0;
    let mut remaining_directories = MAX_IMPORT_FILES;
    let mut remaining_import_bytes = MAX_IMPORT_BYTES;
    let mut entries = Vec::new();

    while let Some(directory) = pending.pop() {
        pending_path_bytes -= directory.as_os_str().len();
        let is_root = directory.as_os_str().is_empty();
        let path = if is_root {
            root.clone()
        } else {
            root.join(&directory)
        };
        let directory_error = |error| {
            if is_root {
                LibraryError::new(
                    "invalid_directory",
                    format!("Could not read the selected package directory ({error})"),
                )
            } else {
                file_error(&directory, error)
            }
        };
        check_directory(&path, &directory, directory_error)?;

        for entry in fs::read_dir(path).map_err(directory_error)? {
            let entry = entry.map_err(directory_error)?;
            let relative = directory.join(entry.file_name());
            let name = relative
                .to_str()
                .ok_or_else(|| {
                    LibraryError::new("package_encoding", "A package path is not UTF-8")
                })?
                .replace(std::path::MAIN_SEPARATOR, "/");
            validate_path(&name)?;
            let metadata = entry
                .metadata()
                .map_err(|error| file_error(&relative, error))?;
            if is_link(&metadata) {
                return Err(LibraryError::invalid(format!(
                    "Package path {name:?} is a link or a reparse point"
                )));
            }
            if metadata.is_dir() {
                // The package limit counts files. Bound directory traversal separately.
                remaining_directories = remaining_directories
                    .checked_sub(1)
                    .ok_or_else(import_too_large)?;
                pending_path_bytes += relative.as_os_str().len();
                if pending_path_bytes > MAX_IMPORT_BYTES {
                    return Err(import_too_large());
                }
                pending.push(relative);
                continue;
            }
            if !metadata.is_file() {
                return Err(LibraryError::invalid(format!(
                    "Package path {name:?} is not a regular file"
                )));
            }
            if entries.len() == MAX_IMPORT_FILES {
                return Err(import_too_large());
            }
            let size = usize::try_from(metadata.len()).map_err(|_| import_too_large())?;
            remaining_import_bytes = remaining_import_bytes
                .checked_sub(name.len())
                .and_then(|remaining| remaining.checked_sub(size))
                .ok_or_else(import_too_large)?;
            entries.push((name, metadata));
        }
    }

    let layout = locate_package_files(entries.iter().map(|(name, _)| name.as_str()))?;
    let mut package_limits = vec![(MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES); layout.package_count()];
    let mut files = Vec::with_capacity(entries.len());
    let mut previous_parent = None;
    for ((name, metadata), location) in entries.into_iter().zip(layout.locations()) {
        let text = if let Some(location) = location {
            let relative_name = &name[location.start..];
            if relative_name != MANIFEST_PATH && !relative_name.ends_with(".md") {
                return Err(LibraryError::invalid(format!(
                    "Unexpected package file {relative_name}"
                )));
            }
            let (remaining_bytes, remaining_files) = &mut package_limits[location.package];
            *remaining_files = remaining_files
                .checked_sub(1)
                .ok_or_else(package_too_large)?;
            *remaining_bytes = remaining_bytes
                .checked_sub(relative_name.len())
                .ok_or_else(package_too_large)?;

            let relative = Path::new(&name);
            let parent = relative.parent().expect("validated file path has a parent");
            if previous_parent.as_deref() != Some(parent) {
                check_parents(&root, parent)?;
                previous_parent = Some(parent.to_owned());
            }

            // Replace the scanned size with the actual number of bytes read.
            remaining_import_bytes += metadata.len() as usize;
            let limit = (*remaining_bytes).min(remaining_import_bytes);
            let limit_error: fn() -> LibraryError = if limit == *remaining_bytes {
                package_too_large
            } else {
                import_too_large
            };
            let text = read_file(
                &root.join(relative),
                relative,
                &metadata,
                limit,
                limit_error,
            )?;
            *remaining_bytes -= text.len();
            remaining_import_bytes -= text.len();
            text
        } else {
            String::new()
        };
        files.push(PackageFile { path: name, text });
    }
    read_packages(files)
}

fn check_directory(
    path: &Path,
    relative: &Path,
    map_error: impl FnOnce(std::io::Error) -> LibraryError,
) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(map_error)?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(LibraryError::new(
            "invalid_directory",
            format!("Expected a regular directory at {relative:?}"),
        ));
    }
    Ok(())
}

fn check_parents(root: &Path, parent: &Path) -> Result<()> {
    for relative in parent.ancestors() {
        let path = if relative.as_os_str().is_empty() {
            root.to_owned()
        } else {
            root.join(relative)
        };
        check_directory(&path, relative, |error| file_error(relative, error))?;
    }
    Ok(())
}

fn read_file(
    path: &Path,
    relative: &Path,
    expected: &Metadata,
    limit: usize,
    limit_error: fn() -> LibraryError,
) -> Result<String> {
    if expected.len() > limit as u64 {
        return Err(limit_error());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|error| file_error(relative, error))?;
    let metadata = file
        .metadata()
        .map_err(|error| file_error(relative, error))?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err(file_error(relative, "expected a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        if metadata.dev() != expected.dev() || metadata.ino() != expected.ino() {
            return Err(file_error(relative, "the file changed while opening"));
        }
    }
    if metadata.len() > limit as u64 {
        return Err(limit_error());
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| file_error(relative, error))?;
    if bytes.len() > limit {
        return Err(limit_error());
    }
    String::from_utf8(bytes).map_err(|_| {
        LibraryError::new(
            "package_encoding",
            format!("Package file {relative:?} is not UTF-8"),
        )
    })
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    metadata.is_symlink()
}

fn package_too_large() -> LibraryError {
    LibraryError::new(
        "package_too_large",
        "The package exceeds 32 MiB or 32768 files",
    )
}

fn file_error(path: &Path, error: impl Display) -> LibraryError {
    LibraryError::new(
        "package_file_read",
        format!("Could not read package path {path:?} ({error})"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_example_library_from_disk() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../examples/problem-libraries/example-graphs");
        let packages = read_directory(&directory).unwrap();
        let [package] = packages.as_slice() else {
            panic!("expected a single library");
        };
        assert_eq!(package.library_id, "example-graphs");
        assert_eq!(package.release_version, 7);
        assert_eq!(package.problems[0].id, "example-graphs:demo:1");
    }

    #[test]
    fn reads_all_example_libraries_from_a_common_directory() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/problem-libraries");
        let packages = read_directory(&directory).unwrap();
        let ids: Vec<_> = packages
            .iter()
            .map(|package| package.library_id.as_str())
            .collect();
        assert_eq!(ids, ["example-basics", "example-graphs"]);
    }

    #[test]
    fn ignores_binary_files_outside_the_library_root() {
        let directory = tempfile::tempdir().unwrap();
        let library = directory.path().join("wrapper/library");
        fs::create_dir_all(&library).unwrap();
        fs::write(directory.path().join("wrapper/notes.md"), [0xff]).unwrap();
        fs::write(
            library.join(MANIFEST_PATH),
            r#"{"formatVersion":1,"libraryId":"library","name":{"en":"Library"},"authorId":"editor","releaseVersion":1,"complete":true,"problems":[]}"#,
        )
        .unwrap();

        let packages = read_directory(directory.path()).unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].library_id, "library");

        fs::write(library.join("notes.md"), [0xff]).unwrap();
        let error = read_directory(directory.path()).unwrap_err();
        assert_eq!(error.code, "package_encoding");
    }

    #[test]
    fn reports_a_missing_manifest() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("notes.txt"), b"No package here").unwrap();
        let error = read_directory(directory.path()).unwrap_err();
        assert_eq!(error.code, "missing_manifest");
    }

    #[test]
    fn counts_package_paths_toward_the_byte_limit() {
        let directory = tempfile::tempdir().unwrap();
        let manifest = fs::File::create(directory.path().join(MANIFEST_PATH)).unwrap();
        manifest.set_len(MAX_PACKAGE_BYTES as u64).unwrap();
        let error = read_directory(directory.path()).unwrap_err();
        assert_eq!(error.code, "package_too_large");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_link_to_a_manifest() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join(MANIFEST_PATH)).unwrap();
        let error = read_directory(directory.path()).unwrap_err();
        assert_eq!(error.code, "invalid_package");
    }
}
