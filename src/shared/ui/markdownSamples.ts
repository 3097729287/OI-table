import type { Code, Heading, Root } from "mdast";

export interface ProblemMarkdownSample {
  input: string;
  expectedOutput?: string;
}

export type MarkdownSampleBlock =
  | { kind: "input"; sample: ProblemMarkdownSample }
  | { kind: "output"; value: string };

const sampleHeading = /^(?:examples?|samples?|样例|示例)(?:\s*#?\s*\d+)?$/i;
const explicitEnglish = /^(?:sample|example)\s+(input|output)(?:\s*#?\s*\d+)?$/i;
const explicitChinese = /^(?:(?:样例|示例)\s*(输入|输出)|(输入|输出)\s*(?:样例|示例))(?:\s*#?\s*\d+)?$/;
const sampleLabel = /^(input|output|输入|输出)(?:\s*#?\s*\d+)?$/i;

function headingText(node: Heading | Heading["children"][number]): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node ? node.children.map(headingText).join("") : "";
}

function plainBlock(node?: Root["children"][number]) {
  if (node?.type !== "code") return undefined;
  const language = node.lang?.toLowerCase();
  if (language && language !== "text" && language !== "txt" && language !== "plaintext") return undefined;
  return { ...node, value: node.value.replace(/\r\n?/g, "\n") };
}

function sampleRole(heading: string, inSampleSection: boolean): MarkdownSampleBlock["kind"] | undefined {
  const chinese = explicitChinese.exec(heading);
  const role = chinese?.[1] ?? chinese?.[2] ?? explicitEnglish.exec(heading)?.[1]
    ?? (inSampleSection ? sampleLabel.exec(heading)?.[1] : undefined);
  if (role === undefined) return undefined;
  return role === "输入" || role.toLowerCase() === "input" ? "input" : "output";
}

export function collectMarkdownSampleBlocks(tree: Root, blocks: Map<number, MarkdownSampleBlock>) {
  let sampleDepth: number | undefined;
  let nextRole: MarkdownSampleBlock["kind"] | undefined;
  let pendingInput: ProblemMarkdownSample | undefined;

  function addBlock(code: Code, block: MarkdownSampleBlock) {
    const offset = code.position?.start.offset;
    if (offset !== undefined) blocks.set(offset, block);
  }

  for (const node of tree.children) {
    if (node.type === "heading") {
      const heading = headingText(node).normalize("NFKC").trim().replace(/:$/, "").trimEnd();
      if (sampleHeading.test(heading)) {
        sampleDepth = node.depth;
        nextRole = undefined;
        pendingInput = undefined;
      } else {
        if (sampleDepth !== undefined && node.depth <= sampleDepth) sampleDepth = undefined;
        nextRole = sampleRole(heading, sampleDepth !== undefined);
        if (nextRole === "input") pendingInput = undefined;
      }
      continue;
    }

    const role = nextRole ?? (sampleDepth !== undefined ? (pendingInput ? "output" : "input") : undefined);
    if (!role) continue;
    const code = plainBlock(node);
    if (!code) continue;
    if (role === "input") {
      pendingInput = { input: code.value };
      addBlock(code, { kind: "input", sample: pendingInput });
      nextRole = "output";
    } else {
      addBlock(code, { kind: "output", value: code.value });
      if (pendingInput) pendingInput.expectedOutput = code.value;
      pendingInput = undefined;
      nextRole = undefined;
    }
  }
}
