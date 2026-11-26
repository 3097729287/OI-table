import { useCallback, useContext, useState } from "react";
import { LocaleContext, useMessages } from "../../i18n";
import { LibraryNavigationRows, useLibraryNavigationRows } from "../../shared/LibraryNavigationRows";
import {
  listLibraryArchiveChildren, listProblemLibraries, localizedLibraryText, type LibraryArchive, type ProblemLibrary,
} from "../../shared/problemLibrary";
import { SidebarBranch } from "../../workspace/SidebarBranch";
import type { SidebarRowProps } from "../../workspace/sidebarMenu";
import { ProblemMenuItems, useProblemMenu } from "../catalog/ProblemMenuItems";
import { archiveTarget, libraryTarget } from "../catalog/navigationTargets";

interface ArchiveBranchProps extends Omit<SidebarRowProps, "title" | "target"> {
  library: ProblemLibrary;
  archive?: LibraryArchive;
}

function ArchiveBranch({ library, depth, archive, ...navigation }: ArchiveBranchProps) {
  const locale = useContext(LocaleContext);
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const archiveId = archive?.id;
  const libraryId = library.id;
  const load = useCallback(() => listLibraryArchiveChildren(libraryId, archiveId), [libraryId, archiveId]);
  const children = useLibraryNavigationRows(load, expanded);
  const title = localizedLibraryText(archive?.name ?? library.name, locale);
  const target = archive ? archiveTarget(libraryId, archive) : libraryTarget(library);
  const hasProblems = (archive?.problemCount ?? 0) > 0;
  const menu = useProblemMenu({ libraryId, archiveId }, expanded && hasProblems);
  const loading = children.loading || (hasProblems && menu.initialLoading);

  return (
    <SidebarBranch {...navigation} title={title} target={target} count={archive?.subtreeProblemCount} depth={depth}
      expanded={expanded} loading={loading} onToggle={() => setExpanded((open) => !open)}>
      <LibraryNavigationRows {...children} empty={hasProblems ? undefined : messages.noLibraryArchives}
        render={(child) => <ArchiveBranch {...navigation} key={child.id} library={library}
          archive={child} depth={depth + 1} />} />
      {hasProblems && <ProblemMenuItems {...navigation} menu={menu} />}
    </SidebarBranch>
  );
}

async function listEnabledLibraries() {
  return (await listProblemLibraries()).filter((library) => library.status === "enabled");
}

export function ArchiveNavigation({ depth, title, target, ...navigation }: SidebarRowProps) {
  const messages = useMessages();
  const [expanded, setExpanded] = useState(false);
  const libraryArchives = target.params.filter === "libraries";
  const libraries = useLibraryNavigationRows(listEnabledLibraries, libraryArchives && expanded);

  return (
    <SidebarBranch {...navigation} title={title} target={target} depth={depth} expanded={expanded}
      loading={libraryArchives && libraries.loading} onToggle={() => setExpanded((open) => !open)}>
      {libraryArchives ? (
        <LibraryNavigationRows {...libraries} empty={messages.noEnabledLibraries}
          render={(library) => <ArchiveBranch {...navigation} key={library.id} library={library} depth={depth + 1} />} />
      ) : <li className="workbench-sidebar__status">{messages.emptyWorkspace}</li>}
    </SidebarBranch>
  );
}
