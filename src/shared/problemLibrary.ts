import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { localizedLabels, type Locale } from "../i18n";
import type { PersonalProblemScope } from "./personalCollections";

export interface LocalizedProblemText {
  zhCN: string | null;
  en: string | null;
}

export type ProblemContentLocale = "zh-CN" | "en";

export function problemContentLocale(locale: Locale | ProblemContentLocale): ProblemContentLocale {
  return locale.split("-")[0] === "zh" ? "zh-CN" : "en";
}

export function localizedLibraryText(text: LocalizedProblemText, locale: Locale | ProblemContentLocale) {
  return (problemContentLocale(locale) === "zh-CN" ? text.zhCN ?? text.en : text.en ?? text.zhCN) ?? "";
}

export function libraryTextLabels(text: LocalizedProblemText) {
  return localizedLabels((locale) => (problemContentLocale(locale) === "zh-CN" ? text.zhCN : text.en) ?? undefined);
}

let libraryRevision = 0;
const libraryChanges = new EventTarget();

function subscribeToLibrary(notify: () => void) {
  libraryChanges.addEventListener("change", notify);
  return () => libraryChanges.removeEventListener("change", notify);
}

export function getLibraryRevision() {
  return libraryRevision;
}

export function useLibraryRevision() {
  return useSyncExternalStore(subscribeToLibrary, getLibraryRevision);
}

function publishLibraryChange() {
  libraryRevision += 1;
  libraryChanges.dispatchEvent(new Event("change"));
}

async function notifyLibraryChange<T>(request: Promise<T>) {
  const result = await request;
  publishLibraryChange();
  return result;
}

export type ProblemLibraryStatus = "enabled" | "disabled" | "uninstalled";

export interface ProblemLibrary {
  id: string;
  name: LocalizedProblemText;
  authorId: string;
  authorName: LocalizedProblemText | null;
  releaseVersion: number;
  problemCount: number;
  status: ProblemLibraryStatus;
}

export interface ProblemLibraryImport {
  library: ProblemLibrary;
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  restored: number;
  replayed: boolean;
}

export interface LibraryProblemQuery {
  libraryId?: string;
  archiveId?: string;
  includeDescendants?: boolean;
  tagId?: string;
  untagged?: boolean;
  personal?: PersonalProblemScope;
  keyword?: string;
  after?: string;
}

export interface LibraryProblem {
  id: string;
  libraryId: string;
  authorId: string;
  sequence: number;
  contentVersion: number;
  title: LocalizedProblemText;
  rating: number | null;
  archiveId: string | null;
  removed?: boolean;
  libraryStatus?: ProblemLibraryStatus;
}

export interface LibraryProblemDetail extends LibraryProblem {
  statement: LocalizedProblemText;
  authorName: LocalizedProblemText | null;
  removed: boolean;
  libraryStatus: ProblemLibraryStatus;
  tags: { id: string; name: LocalizedProblemText }[];
  solutions: { id: string; title: LocalizedProblemText; body: LocalizedProblemText }[];
}

export interface LibraryProblemPage {
  items: LibraryProblem[];
  nextCursor: string | null;
}

export interface ProblemSubmission {
  id: string;
  language: string;
  createdAt: number;
  status: string;
  contentVersion: number;
}

export interface ProblemSubmissionPage {
  items: ProblemSubmission[];
  nextCursor: string | null;
}

export interface LibraryArchive {
  id: string;
  parentId: string | null;
  name: LocalizedProblemText;
  sortOrder: number;
  problemCount: number;
  subtreeProblemCount: number;
}

export interface LibraryTagGroup {
  id: string | null;
  name: LocalizedProblemText | null;
  problemCount: number;
}

export type ProblemLibrarySource = "directory" | "zip";

export function pickProblemLibrarySource(source: ProblemLibrarySource, title: string) {
  return invoke<string | null>("pick_problem_library_source", { source, title });
}

export function importProblemLibrariesFromPath(path: string) {
  return notifyLibraryChange(invoke<ProblemLibraryImport[]>("import_problem_libraries_from_path", { path }));
}

export function listProblemLibraries() {
  return invoke<ProblemLibrary[]>("list_problem_libraries");
}

export function setProblemLibraryEnabled(libraryId: string, enabled: boolean) {
  return notifyLibraryChange(invoke<ProblemLibrary>("set_problem_library_enabled", { libraryId, enabled }));
}

export function uninstallProblemLibrary(libraryId: string) {
  return notifyLibraryChange(invoke<ProblemLibrary>("uninstall_problem_library", { libraryId }));
}

export function listLibraryProblems(query: LibraryProblemQuery = {}) {
  return invoke<LibraryProblemPage>("list_library_problems", { query });
}

export function getLibraryProblem(id: string, contentVersion?: number) {
  return invoke<LibraryProblemDetail>("get_library_problem", { id, contentVersion });
}

export function listProblemSubmissions(problemId: string, after?: string) {
  return invoke<ProblemSubmissionPage>("list_problem_submissions", { problemId, after });
}

export function listLibraryArchiveChildren(libraryId: string, parentId?: string) {
  return invoke<LibraryArchive[]>("list_library_archive_children", { libraryId, parentId });
}

export function listLibraryTagGroups(libraryId?: string) {
  return invoke<LibraryTagGroup[]>("list_library_tag_groups", { libraryId });
}
