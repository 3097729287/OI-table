import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n";

export type PersonalProblemScope =
  | { kind: "favorites" }
  | { kind: "favorite"; id: string };

export interface PersonalCollection {
  id: string;
  name: string;
  problemCount: number;
  builtin: boolean;
}

interface SaveCollectionRequest {
  id?: string;
  name: string;
}

const favoriteLabels = new Map<string, MessageKey>([
  ["to-do", "favoriteToDo"], ["mistakes", "favoriteMistakes"], ["review", "favoriteReview"],
]);

export function collectionName(collection: PersonalCollection, messages: Record<MessageKey, string>) {
  const label = collection.builtin ? favoriteLabels.get(collection.id) : undefined;
  return label ? messages[label] : collection.name;
}

let revision = 0;
let collectionsRequest: Promise<PersonalCollection[]> | undefined;
const changes = new EventTarget();

function subscribe(notify: () => void) {
  changes.addEventListener("change", notify);
  return () => changes.removeEventListener("change", notify);
}

export function getPersonalRevision() {
  return revision;
}

export function usePersonalRevision() {
  return useSyncExternalStore(subscribe, getPersonalRevision);
}

async function notifyChange<T>(request: Promise<T>) {
  const result = await request;
  collectionsRequest = undefined;
  revision += 1;
  changes.dispatchEvent(new Event("change"));
  return result;
}

export function listPersonalCollections() {
  if (collectionsRequest) return collectionsRequest;
  const request = invoke<PersonalCollection[]>("list_personal_collections");
  collectionsRequest = request;
  void request.catch(() => { if (collectionsRequest === request) collectionsRequest = undefined; });
  return request;
}

export function usePersonalCollections() {
  const currentRevision = usePersonalRevision();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ revision: number; attempt: number; collections?: PersonalCollection[]; failed: boolean }>();
  const settled = result?.revision === currentRevision && result.attempt === attempt;

  useEffect(() => {
    let active = true;
    void listPersonalCollections().then(
      (collections) => {
        if (active && currentRevision === getPersonalRevision()) setResult({ revision: currentRevision, attempt, collections, failed: false });
      },
      () => {
        if (active && currentRevision === getPersonalRevision()) {
          setResult((previous) => ({ revision: currentRevision, attempt, collections: previous?.collections, failed: true }));
        }
      },
    );
    return () => { active = false; };
  }, [currentRevision, attempt]);

  return {
    collections: result?.collections,
    loading: !settled,
    failed: settled && result.failed,
    retry: () => setAttempt((count) => count + 1),
  };
}

export function savePersonalCollection(request: SaveCollectionRequest) {
  return notifyChange(invoke<PersonalCollection>("save_personal_collection", { request }));
}

export function deletePersonalCollection(id: string) {
  return notifyChange(invoke<void>("delete_personal_collection", { id }));
}

export function getPersonalMemberships(problemId: string) {
  return invoke<{ favoriteIds: string[] }>("get_personal_memberships", { problemId });
}

export function setPersonalMembership(id: string, problemId: string, included: boolean) {
  return notifyChange(invoke<void>("set_personal_membership", { id, problemId, included }));
}
