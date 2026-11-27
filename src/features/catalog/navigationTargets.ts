import { localizedLabels, t, type Locale } from "../../i18n";
import { libraryTextLabels, localizedLibraryText, type LibraryArchive, type LibraryTagGroup, type ProblemLibrary } from "../../shared/problemLibrary";
import type { WorkspaceTarget } from "../../workspace/layout";

export function tagGroupTarget(group: LibraryTagGroup): WorkspaceTarget & {
  label: Record<Locale, string>;
} {
  const { id, name } = group;
  return {
    id: "catalog",
    params: id === null ? { untagged: "true" } : { tagId: id },
    label: localizedLabels((locale) => id === null ? t("untaggedProblems", undefined, locale)
      : (name && localizedLibraryText(name, locale)) || id),
  };
}

export function libraryTarget(library: ProblemLibrary): WorkspaceTarget {
  return { id: "catalog", params: { libraryId: library.id }, label: libraryTextLabels(library.name) };
}

export function archiveTarget(libraryId: string, archive: LibraryArchive): WorkspaceTarget {
  return { id: "catalog", params: { libraryId, archiveId: archive.id }, label: libraryTextLabels(archive.name) };
}
