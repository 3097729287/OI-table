import { completeFromList, ifNotIn, snippetCompletion } from "@codemirror/autocomplete";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";

export type CodeLanguage = "cpp" | "python";

export const codeLanguageNames: Record<CodeLanguage, string> = {
  cpp: "C++",
  python: "Python",
};

const cppKeywords = `alignas alignof asm auto bool break case catch char class concept const consteval constexpr constinit
  continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int
  long mutable namespace new noexcept nullptr operator private protected public requires return short signed sizeof
  static static_assert static_cast struct switch template this thread_local throw true try typedef typename union
  unsigned using virtual void volatile while`.split(/\s+/);

const cppLibraryNames = [
  "accumulate", "array", "bitset", "cin", "cout", "deque", "fill", "gcd", "greater", "iota", "lower_bound", "map",
  "max", "min", "multiset", "next_permutation", "pair", "priority_queue", "queue", "reverse", "set", "sort", "stack",
  "string", "unordered_map", "unordered_set", "upper_bound", "vector",
];

const cppCompletions = ifNotIn(
  ["LineComment", "BlockComment", "String", "RawString", "CharLiteral", "SystemLibString", "PreprocArg"],
  completeFromList([
    ...cppKeywords.map((label) => ({ label, type: "keyword" })),
    ...cppLibraryNames.map((label) => ({ label, detail: "std" })),
    { label: "std", type: "namespace" },
    snippetCompletion("int main() {\n\t${}\n\treturn 0;\n}", { label: "main", detail: "int main()", type: "function" }),
    snippetCompletion("for (int ${i} = 0; ${i} < ${n}; ++${i}) {\n\t${}\n}",
      { label: "for", detail: "for (int i …)", type: "keyword" }),
  ]),
);

export function codeLanguageExtensions(language: CodeLanguage): Extension {
  return language === "cpp" ? [cpp(), cppLanguage.data.of({ autocomplete: cppCompletions })] : python();
}

const maximumSyntaxDiagnostics = 24;
const cppFunctionMacro = /^[\t ]*#[\t ]*define[\t ]+[A-Za-z_]\w*\(/gm;

export function syntaxDiagnostics(state: EditorState, syntaxError: string): Diagnostic[] {
  const length = state.doc.length;
  if (!length) return [];

  const tree = ensureSyntaxTree(state, length);
  if (!tree) return [];

  // Lezer sees macro calls before expansion. The native check can diagnose these C++ sources.
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
