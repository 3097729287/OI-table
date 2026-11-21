import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const triggerChanged = "oi-table:trigger-changed";
type TriggerChange = [name: string, count: number];

/** Increment the named counter and return its new value. */
export function trigger(name: string) {
  return invoke<number>("increment_trigger", { name });
}

/** Read the current count, or zero if this name has never been triggered. */
export function getTrigger(name: string) {
  return invoke<number>("get_trigger", { name });
}

/** Listen for future increments of this name. Await registration before triggering it. */
export function listenTrigger(name: string, listener: (count: number) => void) {
  return listen<TriggerChange>(triggerChanged, ({ payload: [changedName, count] }) => {
    if (changedName === name) listener(count);
  });
}
