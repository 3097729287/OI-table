import type { MessageKey } from "../i18n";

export type CommandScope = "tab" | "editor" | "workspace" | "window";

const configurableCommands = {
  "editor.toggleBreakpoint": { label: "problemDebugToggleBreakpoint", scope: "editor", defaultKey: "F9" },
  "workbench.toggleSidebar": { label: "sidebarToggle", scope: "workspace", defaultKey: "Mod+B" },
} as const satisfies Record<string, { label: MessageKey; scope: CommandScope; defaultKey: string }>;

export const commands = {
  ...configurableCommands,
  "tabs.previous": { scope: "tab", defaultKey: "ArrowLeft", repeat: true },
  "tabs.next": { scope: "tab", defaultKey: "ArrowRight", repeat: true },
  "tabs.first": { scope: "tab", defaultKey: "Home" },
  "tabs.last": { scope: "tab", defaultKey: "End" },
  "tabs.openMenu": { scope: "tab", defaultKey: "Shift+F10", alternateKey: "ContextMenu" },
} as const;

export type ConfigurableCommandId = keyof typeof configurableCommands;
export const configurableCommandIds = Object.keys(configurableCommands) as ConfigurableCommandId[];
export type CommandId = keyof typeof commands;
export const commandIds = Object.keys(commands) as CommandId[];
export type ShortcutOverrides = Partial<Record<ConfigurableCommandId, string | null>>;
export type CommandHandlers = Partial<Record<CommandId, () => void>>;

export function isConfigurableCommand(id: CommandId): id is ConfigurableCommandId {
  return "label" in commands[id];
}

export function executeCommand(id: CommandId, handlers: CommandHandlers) {
  handlers[id]?.();
}
