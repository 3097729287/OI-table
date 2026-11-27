import type { SidebarSection } from "../../workspace/sidebarMenu";
import { CatalogNavigation } from "./CatalogNavigation";

export default {
  id: "catalog",
  title: "catalog",
  icon: "catalog",
  order: 10,
  children: [
    {
      kind: "group",
      id: "problems",
      title: "catalog",
      children: [
        { kind: "view", viewId: "catalog", Row: CatalogNavigation },
      ],
    },
    {
      kind: "group",
      id: "problem-lists",
      title: "problemLists",
      children: [
        { kind: "view", viewId: "problem-lists", title: "allProblemLists" },
      ],
    },
  ],
} satisfies SidebarSection;
