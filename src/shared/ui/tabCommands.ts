import { registerShortcutScope } from "../keybindings";

type TabAction = (tab: HTMLButtonElement) => void;

export function registerTabCommands(list: HTMLElement, { select, openMenu }: {
  select: TabAction; openMenu?: TabAction;
}) {
  return registerShortcutScope(list, "tab", (target) => {
    const current = target instanceof Element ? target.closest<HTMLButtonElement>("button[role=tab]") : null;
    if (!current || current.closest("[role=tablist]") !== list) return;

    const tabs = [...list.querySelectorAll<HTMLButtonElement>("button[role=tab]")];
    const index = tabs.indexOf(current);
    const last = tabs.length - 1;
    return {
      "tabs.previous": () => select(tabs[index === 0 ? last : index - 1]),
      "tabs.next": () => select(tabs[index === last ? 0 : index + 1]),
      "tabs.first": () => select(tabs[0]),
      "tabs.last": () => select(tabs[last]),
      "tabs.openMenu": openMenu && (() => openMenu(current)),
    };
  });
}
