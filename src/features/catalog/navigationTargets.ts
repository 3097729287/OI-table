import { getMessages } from "../../i18n";
import { localizedLibraryText, type LibraryArchive, type LibraryTagGroup, type LocalizedProblemText, type ProblemLibrary } from "../../shared/problemLibrary";
import type { WorkspaceTarget } from "../../workspace/layout";

function label(text: LocalizedProblemText): WorkspaceTarget["label"] {
  return { "zh-CN": text.zhCN ?? undefined, en: text.en ?? undefined };
}

export function tagGroupTarget(group: LibraryTagGroup): WorkspaceTarget & {
  label: Record<"zh-CN" | "en", string>;
} {
  const { id, name } = group;
  return {
    id: "catalog",
    params: id === null ? { untagged: "true" } : { tagId: id },
    label: {
      "zh-CN": id === null ? getMessages("zh-CN").untaggedProblems : (name && localizedLibraryText(name, "zh-CN")) || id,
      en: id === null ? getMessages("en").untaggedProblems : (name && localizedLibraryText(name, "en")) || id,
    },
  };
}

export function libraryTarget(library: ProblemLibrary): WorkspaceTarget {
  return { id: "catalog", params: { libraryId: library.id }, label: label(library.name) };
}

export function archiveTarget(libraryId: string, archive: LibraryArchive): WorkspaceTarget {
  return { id: "catalog", params: { libraryId, archiveId: archive.id }, label: label(archive.name) };
}
