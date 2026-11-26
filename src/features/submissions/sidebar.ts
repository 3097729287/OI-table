import type { SidebarSection } from "../../workspace/sidebarMenu";

export default {
  id: "submissions",
  title: "submissionHistory",
  icon: "submissions",
  order: 40,
  children: [
    {
      kind: "group",
      id: "records",
      title: "allSubmissions",
      children: [
        { kind: "view", viewId: "submissions", variant: "local" },
        { kind: "view", viewId: "submissions", variant: "online" },
      ],
    },
  ],
} satisfies SidebarSection;
