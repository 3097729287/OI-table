import type { SidebarSection } from "../../workspace/sidebarMenu";

export default {
  id: "settings",
  title: "settings",
  icon: "settings",
  order: 60,
  children: [
    {
      kind: "group",
      id: "settings",
      title: "settings",
      children: [
        { kind: "view", viewId: "settings", variant: "appearance" },
        { kind: "view", viewId: "settings", variant: "editor" },
        { kind: "view", viewId: "settings", variant: "runDebug" },
        { kind: "view", viewId: "settings", variant: "diagnostics" },
      ],
    },
    {
      kind: "group",
      id: "other",
      title: "settingsOther",
      children: [
        { kind: "view", viewId: "settings", variant: "about" },
      ],
    },
  ],
} satisfies SidebarSection;
