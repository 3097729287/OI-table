import { useMemo } from "react";
import { ProblemListPage, type ProblemListFilters } from "../../shared/ProblemListPage";
import type { WorkspaceViewOptions, WorkspaceViewProps } from "../../workspace/views";

export const workspaceView = {
  id: "catalog",
  title: "allProblems",
  icon: "problems",
} satisfies WorkspaceViewOptions;

export default function CatalogView({ params, title, open }: WorkspaceViewProps) {
  const { libraryId, archiveId, tagId, untagged } = params;
  const filters = useMemo<ProblemListFilters>(() => ({
    libraryId, archiveId, includeDescendants: archiveId ? true : undefined, tagId, untagged: untagged === "true" || undefined,
  }), [libraryId, archiveId, tagId, untagged]);

  return <ProblemListPage title={title} open={open} filters={filters} />;
}
