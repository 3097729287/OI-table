import { memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { ScrollArea } from "./ScrollArea";
import "./markdown-viewer.css";

function MarkdownOverflow({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="markdown-viewer__overflow" orientation="horizontal" focusScrollbar>
      {children}
    </ScrollArea>
  );
}

const components: Components = {
  pre: ({ children }) => <MarkdownOverflow><pre>{children}</pre></MarkdownOverflow>,
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

export default memo(function MarkdownViewer({ source }: { source: string }) {
  return (
    <div className="markdown-viewer" data-selectable>
      <Markdown skipHtml components={components} remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: "mathml", trust: false, maxSize: 20 }]]}>
        {source}
      </Markdown>
    </div>
  );
});
