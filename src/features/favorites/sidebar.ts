import type { SidebarSection } from "../../workspace/sidebarMenu";
import { FavoritesNavigation } from "../personal/PersonalNavigation";

export default {
  id: "favorites",
  title: "favorites",
  icon: "favorites",
  order: 30,
  children: [
    {
      kind: "group",
      id: "favorites",
      title: "favorites",
      children: [
        { kind: "view", viewId: "favorites", Row: FavoritesNavigation },
      ],
    },
  ],
} satisfies SidebarSection;
