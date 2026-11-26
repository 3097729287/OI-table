import type { Element } from "hast";
import type { Root } from "mdast";
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Icon } from "../Icon";
import { collectMarkdownSampleBlocks, type MarkdownSampleBlock, type ProblemMarkdownSample } from "./markdownSamples";
import { ScrollArea } from "./ScrollArea";
import "./fields.css";
import "./markdown-viewer.css";

export type { ProblemMarkdownSample } from "./markdownSamples";

export interface ProblemMarkdownSampleActions {
  labels: { run: string; copy: string; fill: string; copied: string; copyFailed: string };
  onRun?: (sample: ProblemMarkdownSample) => void;
  onFill: (input: string) => void;
  runDisabled?: boolean;
}

const SampleContext = createContext<{
  actions: ProblemMarkdownSampleActions;
  blocks: Map<number, MarkdownSampleBlock>;
} | null>(null);

function MarkdownOverflow({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="markdown-viewer__overflow" orientation="horizontal" focusScrollbar>
      {children}
    </ScrollArea>
  );
}

function SampleBlock({ block, actions, children }: {
  block: MarkdownSampleBlock;
  actions: ProblemMarkdownSampleActions;
  children?: ReactNode;
}) {
  const [feedback, setFeedback] = useState<{ value: string; copied: boolean }>();
  const value = block.kind === "input" ? block.sample.input : block.value;
  const currentFeedback = feedback?.value === value ? feedback : undefined;
  const notice = currentFeedback && (currentFeedback.copied ? actions.labels.copied : actions.labels.copyFailed);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(undefined), 1500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ value, copied: true });
    } catch {
      setFeedback({ value, copied: false });
    }
  }

  return (
    <div className="markdown-viewer__sample" data-sample-kind={block.kind}>
      <div className="markdown-viewer__sample-actions">
        {block.kind === "input" && block.sample.expectedOutput !== undefined && actions.onRun && (
          <button type="button" className="ui-icon-button" aria-label={actions.labels.run} title={actions.labels.run}
            disabled={actions.runDisabled} onClick={() => actions.onRun?.(block.sample)}><Icon name="run" /></button>
        )}
        <button type="button" className="ui-icon-button" aria-label={actions.labels.copy} title={notice ?? actions.labels.copy}
          onClick={() => void copy()}><Icon name={currentFeedback?.copied ? "check" : "copy"} /></button>
        {block.kind === "input" && (
          <button type="button" className="ui-icon-button" aria-label={actions.labels.fill} title={actions.labels.fill}
            onClick={() => actions.onFill(block.sample.input)}><Icon name="fillInput" /></button>
        )}
        <span className="markdown-viewer__sample-notice" role="status">{notice}</span>
      </div>
      <MarkdownOverflow><pre>{children}</pre></MarkdownOverflow>
    </div>
  );
}

function MarkdownPre({ node, children }: { node?: Element; children?: ReactNode }) {
  const samples = useContext(SampleContext);
  const offset = node?.position?.start.offset;
  const block = offset !== undefined && samples?.blocks.get(offset);
  return samples && block
    ? <SampleBlock block={block} actions={samples.actions}>{children}</SampleBlock>
    : <MarkdownOverflow><pre>{children}</pre></MarkdownOverflow>;
}

const components: Components = {
  pre: MarkdownPre,
  table: ({ children }) => <MarkdownOverflow><table>{children}</table></MarkdownOverflow>,
  span: ({ node, children, ...props }) => {
    const span = <span {...props}>{children}</span>;
    const displayMath = props.className === "katex" && node?.children.some(
      (child) => child.type === "element" && child.tagName === "math" && child.properties.display === "block",
    );
    return displayMath ? <MarkdownOverflow>{span}</MarkdownOverflow> : span;
  },
  a: ({ href, children }) => (
    <span className="markdown-viewer__reference" title={href}>{children}</span>
  ),
  img: ({ alt }) => alt ? <span className="markdown-viewer__reference">{alt}</span> : null,
};

export default memo(function MarkdownViewer({ source, sampleActions }: {
  source: string;
  sampleActions?: ProblemMarkdownSampleActions;
}) {
  const blocks = new Map<number, MarkdownSampleBlock>();
  const samples = sampleActions ? { actions: sampleActions, blocks } : null;
  const remarkSamples = () => (tree: Root) => collectMarkdownSampleBlocks(tree, blocks);

  return (
    <SampleContext.Provider value={samples}>
      <div className="markdown-viewer" data-selectable>
        <Markdown skipHtml components={components} remarkPlugins={sampleActions ? [remarkGfm, remarkMath, remarkSamples] : [remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { output: "mathml", trust: false, maxSize: 20 }]]}>
          {source}
        </Markdown>
      </div>
    </SampleContext.Provider>
  );
});
