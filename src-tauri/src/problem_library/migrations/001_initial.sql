CREATE TABLE libraries (
    id TEXT PRIMARY KEY NOT NULL,
    name_zh_cn TEXT,
    name_en TEXT,
    author_id TEXT NOT NULL,
    author_name_zh_cn TEXT,
    author_name_en TEXT,
    release_version INTEGER NOT NULL
        CHECK (typeof(release_version) = 'integer' AND release_version BETWEEN 1 AND 9007199254740991),
    package_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'uninstalled')),
    CHECK (name_zh_cn IS NOT NULL OR name_en IS NOT NULL)
);

CREATE TABLE archives (
    library_id TEXT NOT NULL REFERENCES libraries (id),
    id TEXT NOT NULL,
    parent_id TEXT CHECK (parent_id <> id),
    name_zh_cn TEXT,
    name_en TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
    PRIMARY KEY (library_id, id),
    FOREIGN KEY (library_id, parent_id) REFERENCES archives (library_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK (name_zh_cn IS NOT NULL OR name_en IS NOT NULL)
);

CREATE INDEX archives_by_parent ON archives (library_id, parent_id, removed, sort_order, id);

CREATE TABLE problems (
    id TEXT PRIMARY KEY NOT NULL,
    library_id TEXT NOT NULL REFERENCES libraries (id),
    author_id TEXT NOT NULL,
    sequence INTEGER NOT NULL
        CHECK (typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 9007199254740991),
    content_version INTEGER NOT NULL
        CHECK (typeof(content_version) = 'integer' AND content_version BETWEEN 1 AND 9007199254740991),
    content_hash TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
    UNIQUE (library_id, author_id, sequence),
    UNIQUE (id, library_id),
    FOREIGN KEY (id, content_version) REFERENCES problem_versions (problem_id, content_version)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX problems_by_library ON problems (library_id, removed, author_id, sequence);

CREATE TRIGGER problem_identity_is_immutable
BEFORE UPDATE OF id, library_id, author_id, sequence ON problems
WHEN NEW.id <> OLD.id OR NEW.library_id <> OLD.library_id
    OR NEW.author_id <> OLD.author_id OR NEW.sequence <> OLD.sequence
BEGIN
    SELECT RAISE(ABORT, 'problem identity cannot change');
END;

CREATE TABLE problem_versions (
    problem_id TEXT NOT NULL REFERENCES problems (id),
    content_version INTEGER NOT NULL
        CHECK (typeof(content_version) = 'integer' AND content_version BETWEEN 1 AND 9007199254740991),
    title_zh_cn TEXT,
    title_en TEXT,
    statement_zh_cn TEXT,
    statement_en TEXT,
    author_name_zh_cn TEXT,
    author_name_en TEXT,
    rating INTEGER CHECK (rating BETWEEN 0 AND 4294967295),
    archive_id TEXT,
    PRIMARY KEY (problem_id, content_version),
    CHECK (title_zh_cn IS NOT NULL OR title_en IS NOT NULL),
    CHECK ((title_zh_cn IS NULL) = (statement_zh_cn IS NULL)),
    CHECK ((title_en IS NULL) = (statement_en IS NULL))
);

CREATE INDEX problem_versions_by_archive ON problem_versions (archive_id, problem_id, content_version);

-- Archive IDs are local to each library. Keep the library scope on problems.
CREATE TRIGGER problem_version_archive_on_insert
BEFORE INSERT ON problem_versions
WHEN NEW.archive_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM problems
    JOIN archives ON archives.library_id = problems.library_id
    WHERE problems.id = NEW.problem_id AND archives.id = NEW.archive_id
)
BEGIN
    SELECT RAISE(ABORT, 'archive does not belong to the problem library');
END;

CREATE TRIGGER problem_version_archive_on_update
BEFORE UPDATE OF problem_id, archive_id ON problem_versions
WHEN NEW.archive_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM problems
    JOIN archives ON archives.library_id = problems.library_id
    WHERE problems.id = NEW.problem_id AND archives.id = NEW.archive_id
)
BEGIN
    SELECT RAISE(ABORT, 'archive does not belong to the problem library');
END;

CREATE TRIGGER referenced_archive_cannot_be_deleted
BEFORE DELETE ON archives
WHEN EXISTS (
    SELECT 1
    FROM problem_versions
    JOIN problems ON problems.id = problem_versions.problem_id
    WHERE problems.library_id = OLD.library_id AND problem_versions.archive_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'archive is referenced by a problem version');
END;

CREATE TRIGGER referenced_archive_key_cannot_change
BEFORE UPDATE OF library_id, id ON archives
WHEN (NEW.library_id <> OLD.library_id OR NEW.id <> OLD.id) AND EXISTS (
    SELECT 1
    FROM problem_versions
    JOIN problems ON problems.id = problem_versions.problem_id
    WHERE problems.library_id = OLD.library_id AND problem_versions.archive_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'archive is referenced by a problem version');
END;

CREATE TABLE solutions (
    problem_id TEXT NOT NULL,
    content_version INTEGER NOT NULL,
    id TEXT NOT NULL,
    title_zh_cn TEXT,
    title_en TEXT,
    body_zh_cn TEXT,
    body_en TEXT,
    PRIMARY KEY (problem_id, content_version, id),
    FOREIGN KEY (problem_id, content_version) REFERENCES problem_versions (problem_id, content_version),
    CHECK (title_zh_cn IS NOT NULL OR title_en IS NOT NULL),
    CHECK ((title_zh_cn IS NULL) = (body_zh_cn IS NULL)),
    CHECK ((title_en IS NULL) = (body_en IS NULL))
);

CREATE TABLE tags (
    library_id TEXT NOT NULL REFERENCES libraries (id),
    id TEXT NOT NULL,
    name_zh_cn TEXT,
    name_en TEXT,
    PRIMARY KEY (library_id, id),
    CHECK (name_zh_cn IS NOT NULL OR name_en IS NOT NULL)
);

CREATE TABLE problem_tags (
    problem_id TEXT NOT NULL,
    content_version INTEGER NOT NULL,
    library_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (problem_id, content_version, library_id, tag_id),
    FOREIGN KEY (problem_id, content_version) REFERENCES problem_versions (problem_id, content_version),
    FOREIGN KEY (problem_id, library_id) REFERENCES problems (id, library_id),
    FOREIGN KEY (library_id, tag_id) REFERENCES tags (library_id, id)
);

CREATE INDEX problem_tags_by_tag ON problem_tags (library_id, tag_id, problem_id, content_version);

CREATE TABLE problem_folders (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT REFERENCES problem_folders (id) CHECK (parent_id <> id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX problem_folders_by_parent ON problem_folders (parent_id, sort_order, id);

CREATE TABLE problem_lists (
    id TEXT PRIMARY KEY NOT NULL,
    folder_id TEXT REFERENCES problem_folders (id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX problem_lists_by_folder ON problem_lists (folder_id, sort_order, id);

CREATE TABLE problem_list_items (
    list_id TEXT NOT NULL REFERENCES problem_lists (id) ON DELETE CASCADE,
    problem_id TEXT NOT NULL REFERENCES problems (id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, problem_id)
);

CREATE INDEX problem_list_items_by_order ON problem_list_items (list_id, sort_order, problem_id);
CREATE INDEX problem_list_items_by_problem ON problem_list_items (problem_id, list_id);

CREATE TABLE personal_favorite_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE favorites (
    group_id TEXT NOT NULL REFERENCES personal_favorite_groups (id) ON DELETE CASCADE,
    problem_id TEXT NOT NULL REFERENCES problems (id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, problem_id)
);

CREATE INDEX favorites_by_problem ON favorites (problem_id, group_id);

CREATE TABLE submissions (
    id TEXT PRIMARY KEY NOT NULL,
    problem_id TEXT NOT NULL,
    content_version INTEGER NOT NULL,
    source TEXT NOT NULL,
    language TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (problem_id, content_version) REFERENCES problem_versions (problem_id, content_version)
);

CREATE INDEX submissions_by_problem ON submissions (problem_id, content_version, created_at DESC, id);
CREATE INDEX submissions_by_date ON submissions (created_at DESC, id);
