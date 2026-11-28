import { commandIds, commands, executeCommand, isConfigurableCommand,
  type CommandHandlers, type CommandScope, type ConfigurableCommandId, type ShortcutOverrides } from "./commands";
import { getSettingsSnapshot } from "./settings";

const functionKey = /^F(?:[1-9]|1\d|2[0-4])$/;
const namedKeys = /^(?:Backspace|Delete|Insert|Enter|Escape|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|Tab|ContextMenu)$/;
const punctuation = new Map([
  ["Backquote", "\x60"], ["Minus", "-"], ["Equal", "="], ["BracketLeft", "["], ["BracketRight", "]"],
  ["Backslash", "\\"], ["Semicolon", ";"], ["Quote", "'"], ["Comma", ","], ["Period", "."], ["Slash", "/"],
]);
const localKeyboard = "input, textarea, select, [role=menu], [role=dialog], dialog[open]";
type ScopeHandlers = CommandHandlers | ((origin: EventTarget | null) => CommandHandlers | undefined);
const scopes = new WeakMap<EventTarget, { scope: CommandScope; handlers: ScopeHandlers }>();
type Recorder = { area: HTMLElement; input: HTMLInputElement; finish: (shortcut?: string) => void };
let recorder: Recorder | undefined;
const browserChords = new Set([
  "D", "F", "G", "H", "J", "L", "N", "O", "P", "R", "S", "T", "U", "W", "0", "+", "=", "-", "TAB",
]);
const shiftedBrowserChords = new Set(["B", "C", "D", "F", "G", "I", "J", "N", "P", "R", "T", "W", "DELETE"]);

export function shortcutFor(id: ConfigurableCommandId, overrides?: ShortcutOverrides): string | null {
  const override = overrides?.[id];
  if (override !== undefined) return override;
  const fallback = commands[id].defaultKey;
  const primary = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Meta" : "Ctrl";
  return fallback.replace(/^Mod\+/, primary + "+");
}

function chordFromEvent(event: KeyboardEvent) {
  if (event.isComposing || event.getModifierState("AltGraph")) return undefined;
  const { key, code, ctrlKey, altKey, shiftKey, metaKey } = event;
  const base = /^[a-z0-9]$/i.test(key) ? key.toUpperCase()
    : key === " " ? "Space"
    : functionKey.test(key) || namedKeys.test(key) ? key
    : /^Digit[0-9]$/.test(code) ? code.slice(-1)
    : key.length === 1 && punctuation.has(code) ? code
    : undefined;
  if (!base || (!ctrlKey && !altKey && !metaKey && !functionKey.test(base) && !namedKeys.test(base))) return;

  return [ctrlKey && "Ctrl", altKey && "Alt", shiftKey && "Shift", metaKey && "Meta", base].filter(Boolean).join("+");
}

function recordableShortcut(event: KeyboardEvent) {
  if (event.key === "ContextMenu" || (!event.ctrlKey && !event.altKey && !event.metaKey && !functionKey.test(event.key))) return;
  return chordFromEvent(event);
}

export function formatShortcut(shortcut: string) {
  const parts = shortcut.split("+");
  return parts.map((part) => punctuation.get(part) ?? part).join("+");
}

export function registerShortcutScope(target: EventTarget, scope: CommandScope, handlers: ScopeHandlers) {
  const registration = { scope, handlers };
  scopes.set(target, registration);
  return () => { if (scopes.get(target) === registration) scopes.delete(target); };
}

export function registerShortcutRecorder(area: HTMLElement, input: HTMLInputElement, finish: Recorder["finish"]) {
  const registration = { area, input, finish };
  recorder = registration;
  return () => { if (recorder === registration) recorder = undefined; };
}

function captureShortcut(event: KeyboardEvent, { input, finish }: Recorder) {
  const modified = event.ctrlKey || event.altKey || event.metaKey;
  event.stopPropagation();
  if (!modified && (event.key === "Tab" || (event.target !== input && (event.key === "Enter" || event.key === " ")))) return;
  event.preventDefault();
  if (event.key === "Escape" && !modified && !event.shiftKey) {
    finish();
    return;
  }
  if (event.repeat) return;
  const shortcut = recordableShortcut(event);
  if (shortcut) finish(shortcut);
}

function dispatchShortcut(event: KeyboardEvent, phase: "focused" | "outer") {
  if (event.defaultPrevented) return;
  const shortcut = chordFromEvent(event);
  if (!shortcut) return;
  const overrides = getSettingsSnapshot().settings?.keybindings;
  for (const target of event.composedPath()) {
    const scopePhase = target instanceof Element ? "focused" : "outer";
    const registration = scopes.get(target);
    if (registration && scopePhase === phase) {
      const { scope, handlers: registered } = registration;
      const handlers = typeof registered === "function" ? registered(event.target) : registered;
      const command = handlers && commandIds.find((id) => {
        const definition = commands[id];
        if (definition.scope !== scope || !handlers[id]) return false;
        if (isConfigurableCommand(id)) return shortcutFor(id, overrides) === shortcut;
        return definition.defaultKey === shortcut || ("alternateKey" in definition && definition.alternateKey === shortcut);
      });
      if (command && handlers) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat || "repeat" in commands[command]) executeCommand(command, handlers);
        return;
      }
    }
    if (target instanceof Element && target.matches(localKeyboard)) return;
  }
}

function suppressPageShortcuts(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.getModifierState("AltGraph")) return;
  const key = event.key.toUpperCase();
  const modified = event.ctrlKey || event.metaKey;
  const pageShortcut = modified && !event.altKey && (
    browserChords.has(key) || (event.shiftKey && shiftedBrowserChords.has(key))
  );
  const historyShortcut = event.altKey && !modified && ["ARROWLEFT", "ARROWRIGHT", "HOME"].includes(key);
  const focusTraversal = key === "TAB" && !modified && !event.altKey;
  if (pageShortcut || historyShortcut || focusTraversal || functionKey.test(key) || key.startsWith("BROWSER")) {
    event.preventDefault();
  }
}

export function installKeybindings(document: Document) {
  const focused = (event: KeyboardEvent) => {
    if (recorder && event.target instanceof Node && recorder.area.contains(event.target)) {
      captureShortcut(event, recorder);
      return;
    }
    dispatchShortcut(event, "focused");
  };
  const outer = (event: KeyboardEvent) => {
    // Let the focused control handle its built-in keys before trying the outer scopes.
    dispatchShortcut(event, "outer");
    suppressPageShortcuts(event);
  };
  document.addEventListener("keydown", focused, true);
  document.addEventListener("keydown", outer);
  return () => {
    document.removeEventListener("keydown", focused, true);
    document.removeEventListener("keydown", outer);
  };
}
