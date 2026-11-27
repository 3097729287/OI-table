import { useState } from "react";
import { locale, t } from "../../i18n";
import { LibraryNavigationRows, useLibraryNavigationRows } from "../../shared/LibraryNavigationRows";
import { listLibraryTagGroups, type LibraryTagGroup } from "../../shared/problemLibrary";
import { SidebarBranch } from "../../workspace/SidebarBranch";
import type { SidebarRowProps } from "../../workspace/sidebarMenu";
import { ProblemMenuItems, useProblemMenu } from "./ProblemMenuItems";
import { tagGroupTarget } from "./navigationTargets";

type TagBranchProps = Omit<SidebarRowProps, "title" | "target"> & { group: LibraryTagGroup };

function TagBranch({ group, depth, ...navigation }: TagBranchProps) {
  const [expanded, setExpanded] = useState(false);
  const target = tagGroupTarget(group);
  const query = group.id === null ? { untagged: true } : { tagId: group.id };
  const menu = useProblemMenu(query, expanded);

  return (
    <SidebarBranch {...navigation} title={target.label[locale]} target={target} count={group.problemCount}
      depth={depth} expanded={expanded} loading={menu.initialLoading} onToggle={() => setExpanded((open) => !open)}>
      <ProblemMenuItems {...navigation} menu={menu} />
    </SidebarBranch>
  );
}

export function CatalogNavigation({ depth, title, target, ...navigation }: SidebarRowProps) {
  const [expanded, setExpanded] = useState(false);
  const groups = useLibraryNavigationRows(listLibraryTagGroups, expanded);

  return (
    <SidebarBranch {...navigation} title={title} target={target} depth={depth} expanded={expanded}
      loading={groups.loading} onToggle={() => setExpanded((open) => !open)}>
      <LibraryNavigationRows {...groups} empty={t("emptyWorkspace")}
        render={(group) => <TagBranch {...navigation} key={group.id ?? ""} group={group} depth={depth + 1} />} />
    </SidebarBranch>
  );
}
