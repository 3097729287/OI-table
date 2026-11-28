import type { Element } from "hast";
import type { Root } from "mdast";
import { createContext, Fragment, memo, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { t } from "../../i18n";
import { codeLanguageOptions, type CodeLanguage } from "../codeLanguages";
import { highlightCode } from "../editor/syntaxHighlighting";
import { Icon } from "../Icon";
import { collectMarkdownCodeBlocks, type MarkdownCodeBlocks, type MarkdownCodeVariant } from "../markdown/codeExamples";
import { collectMarkdownSampleBlocks, type MarkdownSampleBlock, type ProblemMarkdownSample } from "./markdownSamples";
import { ScrollArea } from "./ScrollArea";
import { registerTabCommands } from "./tabCommands";
import "./fields.css";
import "./markdown-viewer.css";

export type { ProblemMarkdownSample } from "./markdownSamples";

export interface ProblemMarkdownSampleActions {
  labels: { run: string; copy: string; fill: string; copied: string; copyFailed: string };
  onRun?: (sample: ProblemMarkdownSample) => void;
  onFill: (input: string) => void;
  runDisabled?: boolean;
}

const MarkdownBlocksContext = createContext<{
  sampleActions?: ProblemMarkdownSampleActions;
  samples: Map<number, MarkdownSampleBlock>;
  code: MarkdownCodeBlocks;
} | null>(null);
const languageLabels = new Map(codeLanguageOptions.map(({ value, label }) => [value, label]));

function MarkdownOverflow({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="markdown-viewer__overflow" orientation="horizontal" focusScrollbar>
      {children}
    </ScrollArea>
  );
}

function MarkdownCopyButton({ value, label, feedbackLabels }: {
  value: string;
  label: string;
  feedbackLabels?: Pick<ProblemMarkdownSampleActions["labels"], "copied" | "copyFailed">;
}) {
  const [feedback, setFeedback] = useState<{ value: string; copied: boolean }>();
  const latestCopy = useRef(0);
  const currentFeedback = feedback?.value === value ? feedback : undefined;
  const notice = currentFeedback && (currentFeedback.copied ? feedbackLabels?.copied : feedbackLabels?.copyFailed);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(undefined), 1500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function copy() {
    const request = ++latestCopy.current;
    let copied: boolean;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      copied = false;
    }
    if (feedbackLabels && request === latestCopy.current) setFeedback({ value, copied });
  }

  return (
    <>
      <button type="button" className="ui-icon-button" aria-label={label} title={label}
        onClick={() => void copy()}><Icon name="copy" /></button>
      {feedbackLabels && <span className="markdown-viewer__copy-notice" role="status">{notice}</span>}
    </>
  );
}

function SampleBlock({ block, actions, children }: {
  block: MarkdownSampleBlock;
  actions: ProblemMarkdownSampleActions;
  children?: ReactNode;
}) {
  const value = block.kind === "input" ? block.sample.input : block.value;
  return (
    <div className="markdown-viewer__sample" data-sample-kind={block.kind}>
      <div className="markdown-viewer__sample-actions">
        {block.kind === "input" && block.sample.expectedOutput !== undefined && actions.onRun && (
          <button type="button" className="ui-icon-button" aria-label={actions.labels.run} title={actions.labels.run}
            disabled={actions.runDisabled} onClick={() => actions.onRun?.(block.sample)}><Icon name="run" /></button>
        )}
        <MarkdownCopyButton value={value} label={actions.labels.copy} feedbackLabels={actions.labels} />
        {block.kind === "input" && (
          <button type="button" className="ui-icon-button" aria-label={actions.labels.fill} title={actions.labels.fill}
            onClick={() => actions.onFill(block.sample.input)}><Icon name="fillInput" /></button>
        )}
      </div>
      <MarkdownOverflow><pre>{children}</pre></MarkdownOverflow>
    </div>
  );
}

function HighlightedCodeBlock({ language, source }: MarkdownCodeVariant) {
  const [rendered, setRendered] = useState<{
    language: CodeLanguage; source: string; parts: Awaited<ReturnType<typeof highlightCode>>;
  }>();
  const parts = rendered?.language === language && rendered.source === source ? rendered.parts : undefined;
  useEffect(() => {
    let active = true;
    void highlightCode(source, language).then((parts) => {
      if (active) setRendered({ language, source, parts });
    }, () => { /* The source stays readable if the language parser fails to load. */ });
    return () => { active = false; };
  }, [source, language]);

  return (
    <MarkdownOverflow>
      <pre><code className={`language-${language}`}>
        {parts?.map(({ from, to, className }) => className
          ? <span key={from} className={className}>{source.slice(from, to)}</span>
          : <Fragment key={from}>{source.slice(from, to)}</Fragment>) ?? source}
      </code></pre>
    </MarkdownOverflow>
  );
}

function MarkdownCodeTabs({ variants }: { variants: readonly MarkdownCodeVariant[] }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = variants[activeIndex] ? activeIndex : 0;

  useLayoutEffect(() => {
    if (!list.current) return;
    return registerTabCommands(list.current, {
      select(button) {
        const index = Number(button.dataset.variantIndex);
        if (!variants[index]) return;
        setActiveIndex(index);
        button.focus({ preventScroll: true });
      },
    });
  }, [variants]);

  useLayoutEffect(() => {
    const strip = viewport.current;
    const tab = list.current?.querySelector('[aria-selected="true"]');
    if (!strip || !tab) return;
    const bounds = strip.getBoundingClientRect();
    const item = tab.getBoundingClientRect();
    if (item.left < bounds.left || item.width > bounds.width) strip.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
  }, [selected, variants]);

  return (
    <div className="markdown-viewer__code-example">
      <ScrollArea className="markdown-viewer__code-tab-strip" viewportRef={viewport} orientation="horizontal" focusScrollbar>
        <div ref={list} className="markdown-viewer__code-tabs" role="tablist" aria-label={t("problemCodeTab")}>
          {variants.map(({ language, title }, index) => (
            <button key={index} id={`${id}-tab-${index}`} data-variant-index={index} type="button" role="tab"
              aria-controls={`${id}-panel-${index}`} aria-selected={selected === index}
              tabIndex={selected === index ? 0 : -1} onClick={() => setActiveIndex(index)}>
              {title ?? languageLabels.get(language)}
            </button>
          ))}
        </div>
      </ScrollArea>
      {variants.map((variant, index) => (
        <div key={index} id={`${id}-panel-${index}`} className="markdown-viewer__code-panel" role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`} hidden={selected !== index}>
          {selected === index && (
            <>
              <HighlightedCodeBlock {...variant} />
              <div className="markdown-viewer__code-copy">
                <MarkdownCopyButton value={variant.source} label={t("problemCodeCopy")} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function MarkdownPre({ node, children }: { node?: Element; children?: ReactNode }) {
  const blocks = useContext(MarkdownBlocksContext);
  const offset = node?.position?.start.offset;
  if (blocks && offset !== undefined) {
    const sample = blocks.samples.get(offset);
    if (sample && blocks.sampleActions) return <SampleBlock block={sample} actions={blocks.sampleActions}>{children}</SampleBlock>;
    const variants = blocks.code.get(offset);
    if (variants === null) return null;
    if (variants) return variants.length === 1 && variants[0].title === undefined
      ? <HighlightedCodeBlock {...variants[0]} /> : <MarkdownCodeTabs variants={variants} />;
  }
  return <MarkdownOverflow><pre>{children}</pre></MarkdownOverflow>;
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
  const samples = new Map<number, MarkdownSampleBlock>();
  const code: MarkdownCodeBlocks = new Map();
  const remarkBlocks = () => (tree: Root) => {
    if (sampleActions) collectMarkdownSampleBlocks(tree, samples);
    collectMarkdownCodeBlocks(tree, code);
  };

  return (
    <MarkdownBlocksContext.Provider value={{ sampleActions, samples, code }}>
      <div className="markdown-viewer" data-selectable>
        <Markdown skipHtml components={components} remarkPlugins={[remarkGfm, remarkMath, remarkBlocks]}
          rehypePlugins={[[rehypeKatex, { output: "mathml", trust: false, maxSize: 20 }]]}>
          {source}
        </Markdown>
      </div>
    </MarkdownBlocksContext.Provider>
  );
});
