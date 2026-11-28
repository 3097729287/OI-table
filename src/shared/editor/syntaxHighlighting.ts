import type { Parser } from "@lezer/common";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import type { CodeLanguage } from "../codeLanguages";

export const codeHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], class: "code-syntax-keyword" },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "code-syntax-type" },
  { tag: [tags.string, tags.regexp], class: "code-syntax-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "code-syntax-number" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "code-syntax-function" },
  { tag: [tags.comment, tags.docComment], class: "code-syntax-comment" },
  { tag: tags.meta, class: "code-syntax-meta" },
]);

const loadParser = {
  cpp: () => import("@codemirror/lang-cpp").then(({ cppLanguage }) => cppLanguage.parser),
  python: () => import("@codemirror/lang-python").then(({ pythonLanguage }) => pythonLanguage.parser),
} satisfies Record<CodeLanguage, () => Promise<Parser>>;

export async function highlightCode(source: string, language: CodeLanguage) {
  const parser = await loadParser[language]();
  const parts: { from: number; to: number; className?: string }[] = [];
  let position = 0;
  highlightTree(parser.parse(source), codeHighlighter, (from, to, className) => {
    if (from > position) parts.push({ from: position, to: from });
    parts.push({ from, to, className });
    position = to;
  });
  if (position < source.length) parts.push({ from: position, to: source.length });
  return parts;
}
