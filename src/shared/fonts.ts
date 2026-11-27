import { t, type MessageKey } from "../i18n";

const fontLabels = {
  system: "fontSystem",
  yahei: "fontYahei",
  serif: "fontSerif",
  monospace: "fontMonospace",
  "fira-code": "fontFiraCode",
} satisfies Record<string, MessageKey>;

export type FontPreset = keyof typeof fontLabels;

export function getFontOptions() {
  return (Object.keys(fontLabels) as FontPreset[]).map((value) => ({ value, label: t(fontLabels[value]) }));
}
