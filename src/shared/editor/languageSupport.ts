import {
  autocompletion, completeFromList, ifNotIn, snippetCompletion,
  type CompletionContext, type CompletionResult, type CompletionSource,
} from "@codemirror/autocomplete";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { globalCompletion as pythonGlobalCompletions, pythonLanguage } from "@codemirror/lang-python";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";

import type { CodeLanguage } from "../codeLanguages";
import { contestTemplates, cppCompletionCatalog, pythonCompletionCatalog } from "./completion/catalog";
import { cppDirectiveCompletions, cppImportCompletions, pythonImportCompletions } from "./completion/imports";
import { cppVariableCompletions, pythonForCompletion, pythonVariableCompletions } from "./completion/variables";

type ContextCompletion = (context: CompletionContext) => CompletionResult | null;

const templateOptions = {
  cpp: contestTemplates.cpp.map(contestSnippet),
  python: contestTemplates.python.map(contestSnippet),
};
const templateExcluded = new Set(["Comment", "LineComment", "BlockComment", "String", "FormatString", "RawString", "CharLiteral", "PreprocDirective"]);
const pythonFunctionNames = pythonCompletionCatalog.functionNames.map((label, index, names) => ({
  label, type: "function", boost: names.length - index,
}));
const pythonKeywords = pythonCompletionCatalog.keywords.map((label) => ({ label, type: "keyword" }));
const pythonFollowUpKeywords = new Set(["import", "from", "def", "for"]);

export const codeAutocomplete = autocompletion({
  activateOnCompletion: ({ label, displayLabel, apply }) =>
    ((pythonFollowUpKeywords.has(label) || label === "in") && apply === `${label} `) || displayLabel === "#include",
});

const cppCompletions = ifNotIn(
  ["LineComment", "BlockComment", "String", "RawString", "CharLiteral", "PreprocDirective", "ScopedIdentifier", "ScopedTypeIdentifier", "FieldExpression"],
  completeFromList([
    ...cppCompletionCatalog.keywords.map((label) => ({ label, type: "keyword" })),
    ...cppCompletionCatalog.namespaces.map((label) => ({ label, type: "namespace" })),
    ...cppCompletionCatalog.snippets.map(({ template, ...completion }) => snippetCompletion(template, { ...completion, type: "snippet" })),
  ]),
);

const pythonCompletions: CompletionSource = async (context) => {
  if (context.matchBefore(/\.[\t ]*\p{ID_Continue}*$/u)) return null;
  const result = await pythonGlobalCompletions(context);
  if (!result) return null;
  const existingLabels = new Set(result.options.map(({ label }) => label));
  return {
    ...result,
    options: [...result.options, ...pythonKeywords.filter(({ label }) => !existingLabels.has(label))]
      .map((option) => pythonFollowUpKeywords.has(option.label) ? { ...option, apply: `${option.label} ` } : option),
  };
};

function contestSnippet({ label, detail, lines }: { label: string; detail: string; lines: string[] }) {
  return snippetCompletion(lines.join("\n"), { label, detail, type: "snippet" });
}

function templateCompletion({ state, pos }: CompletionContext, language: CodeLanguage): CompletionResult | null {
  const line = state.doc.lineAt(pos);
  const prefix = /^[\t ]*(![\w-]*)$/.exec(state.sliceDoc(line.from, pos));
  if (!prefix) return null;
  const suffix = /^([\w-]*)[\t ]*$/.exec(state.sliceDoc(pos, line.to));
  if (!suffix) return null;

  const tree = ensureSyntaxTree(state, pos, 8);
  if (!tree) return null;
  for (let node: typeof tree.topNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (templateExcluded.has(node.name)) return null;
  }
  return { from: pos - prefix[1].length, to: pos + suffix[1].length, options: templateOptions[language], validFor: /^![\w-]*$/ };
}

function pythonFunctionNameCompletion({ state, pos }: CompletionContext): CompletionResult | null {
  const line = state.doc.lineAt(pos);
  const prefix = /^[\t ]*(?:async[\t ]+)?def[\t ]+([\p{ID_Start}_]\p{ID_Continue}*|)$/u.exec(state.sliceDoc(line.from, pos));
  if (!prefix) return null;

  const tree = ensureSyntaxTree(state, pos, 8);
  if (!tree) return null;
  let node: typeof tree.topNode | null = tree.resolveInner(pos, -1);
  while (node && node.name !== "FunctionDefinition") node = node.parent;
  const keyword = node?.getChild("def");
  if (!keyword || keyword.from < line.from) return null;

  const suffix = /^\p{ID_Continue}*/u.exec(state.sliceDoc(pos, line.to))?.[0] ?? "";
  return { from: pos - prefix[1].length, to: pos + suffix.length, options: pythonFunctionNames, validFor: /^\p{ID_Continue}*$/u };
}

function completionSources(contextual: ContextCompletion, ...sources: CompletionSource[]): CompletionSource[] {
  // CodeMirror creates a separate context for each source, so share the result by editor state.
  const contextualResults = new WeakMap<EditorState, { pos: number; explicit: boolean; result: CompletionResult | null }>();
  const getContextualResult: ContextCompletion = (context) => {
    const { state, pos, explicit } = context;
    const previous = contextualResults.get(state);
    if (previous?.pos === pos && previous.explicit === explicit) return previous.result;

    const result = contextual(context);
    contextualResults.set(state, { pos, explicit, result });
    return result;
  };
  return [getContextualResult, ...sources.map((source): CompletionSource => (context) =>
    getContextualResult(context) ? null : source(context))];
}

const languageExtensions: Record<CodeLanguage, Extension> = {
  cpp: [cpp(), completionSources((context) => templateCompletion(context, "cpp") ?? cppDirectiveCompletions(context),
    cppCompletions, cppImportCompletions, cppVariableCompletions)
    .map((autocomplete) => cppLanguage.data.of({ autocomplete }))],
  python: [pythonLanguage, completionSources((context) =>
    templateCompletion(context, "python") ?? pythonFunctionNameCompletion(context) ?? pythonForCompletion(context),
    pythonCompletions, pythonImportCompletions, pythonVariableCompletions)
    .map((autocomplete) => pythonLanguage.data.of({ autocomplete }))],
};

const maximumSyntaxDiagnostics = 24;
const cppFunctionMacro = /^[\t ]*#[\t ]*define[\t ]+[A-Za-z_]\w*\(/gm;

export function codeLanguageExtensions(language: CodeLanguage): Extension {
  return languageExtensions[language];
}

export function syntaxDiagnostics(state: EditorState, syntaxError: string): Diagnostic[] {
  const length = state.doc.length;
  if (!length) return [];

  const tree = ensureSyntaxTree(state, length);
  if (!tree) return [];

  // Lezer sees macro calls before expansion. The compiler reports errors in these sources during a run.
  if (cppLanguage.isActiveAt(state, 0)) {
    for (const match of state.doc.toString().matchAll(cppFunctionMacro)) {
      const directive = tree.resolveInner(match.index + match[0].indexOf("#"), 1);
      if (directive.parent?.name === "PreprocDirective") return [];
    }
  }

  const diagnostics: Diagnostic[] = [];
  const cursor = tree.cursor();
  do {
    if (!cursor.type.isError) continue;

    const from = Math.min(cursor.from, length - 1);
    const to = Math.max(cursor.to, from + 1);
    const previous = diagnostics.at(-1);
    if (previous?.from === from && previous.to === to) continue;

    diagnostics.push({ from, to, severity: "warning", message: syntaxError });
    if (diagnostics.length >= maximumSyntaxDiagnostics) break;
  } while (cursor.next());

  return diagnostics;
}
