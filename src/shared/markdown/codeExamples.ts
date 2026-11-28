import type { Parent, RootContent } from "mdast";
import { codeLanguageOptions, type CodeLanguage } from "../codeLanguages";

export interface MarkdownCodeVariant {
  language: CodeLanguage;
  title?: string;
  source: string;
}

export type MarkdownCodeBlocks = Map<number, readonly MarkdownCodeVariant[] | null>;

const aliases = new Map<string, CodeLanguage>([
  ["c++", "cpp"], ["cc", "cpp"], ["cxx", "cpp"], ["py", "python"], ["python3", "python"],
]);

function readCodeBlock(node?: RootContent) {
  if (node?.type !== "code") return;
  const offset = node.position?.start.offset;
  const name = node.lang?.toLowerCase() ?? "";
  const language = aliases.get(name) ?? codeLanguageOptions.find(({ value }) => value === name)?.value;
  if (offset === undefined || !language) return;

  let group: string | undefined;
  let title: string | undefined;
  for (const [, key, doubleQuoted, singleQuoted, bare] of (node.meta ?? "").matchAll(
    /(?:^|\s)([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?=\s|$)/g,
  )) {
    const value = (doubleQuoted ?? singleQuoted ?? bare).trim() || undefined;
    if (key === "example") group = value;
    if (key === "title") title = value;
  }
  return { offset, group, variant: { language, title, source: node.value } };
}

export function collectMarkdownCodeBlocks({ children }: Parent, blocks: MarkdownCodeBlocks) {
  for (let index = 0; index < children.length;) {
    const node = children[index++];
    if ("children" in node) collectMarkdownCodeBlocks(node, blocks);
    const first = readCodeBlock(node);
    if (!first) continue;

    const group = [first];
    if (first.group) {
      for (let next = readCodeBlock(children[index]); next?.group === first.group; next = readCodeBlock(children[index])) {
        group.push(next);
        index++;
      }
    }

    blocks.set(first.offset, group.map(({ variant }) => variant));
    for (const { offset } of group.slice(1)) blocks.set(offset, null);
  }
}
