import type { SidebarSection } from "../../workspace/sidebarMenu";
import { ArchiveNavigation } from "../catalog/LibraryNavigation";

export default {
  id: "archive",
  title: "archive",
  icon: "archive",
  order: 20,
  children: [
    {
      kind: "group",
      id: "all-archives",
      title: "allArchives",
      children: [
        { kind: "view", viewId: "archive", variant: "contests", Row: ArchiveNavigation },
        { kind: "view", viewId: "archive", variant: "libraries", Row: ArchiveNavigation },
      ],
    },
  ],
} satisfies SidebarSection;
