import type { EditorView } from "@codemirror/view";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../../i18n";
import { Scrollbar } from "./Scrollbar";

interface ScrollBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function CodeEditorScrollbars({ editor }: { editor: EditorView }) {
  const messages = useMessages();
  const id = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<ScrollBounds>();
  const viewport = useMemo(() => ({ current: editor.scrollDOM }), [editor]);
  const content = useMemo(() => ({ current: editor.contentDOM }), [editor]);
  const controls = editor.scrollDOM.id || id;

  useLayoutEffect(() => {
    const host = overlay.current?.parentElement;
    if (!host) return;

    const scroller = editor.scrollDOM;
    const previousId = scroller.id;
    if (!previousId) scroller.id = id;

    const measure = () => {
      const area = host.getBoundingClientRect();
      const scrollport = scroller.getBoundingClientRect();
      const next = { top: scrollport.top - area.top, left: scrollport.left - area.left,
        width: scrollport.width, height: scrollport.height };
      setBounds((previous) => previous?.top === next.top && previous.left === next.left &&
        previous.width === next.width && previous.height === next.height ? previous : next);
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    resize.observe(scroller);
    const panels = new MutationObserver(measure);
    panels.observe(editor.dom, { childList: true });
    return () => {
      resize.disconnect();
      panels.disconnect();
      if (!previousId && scroller.id === id) scroller.removeAttribute("id");
    };
  }, [editor, id]);

  return (
    <>
      <div ref={overlay} className="code-editor__scrollbars" style={bounds}>
        <Scrollbar viewport={viewport} content={content} controls={controls}
          label={messages.scrollVertically} orientation="vertical" />
        <Scrollbar viewport={viewport} content={content} controls={controls}
          label={messages.scrollHorizontally} orientation="horizontal" />
      </div>
      <EditorPopupScrollbars editor={editor} />
    </>
  );
}

const popupListSelectors = [".cm-tooltip-autocomplete > ul", ".cm-panel-lint > ul"];

function EditorPopupScrollbars({ editor }: { editor: EditorView }) {
  const [lists, setLists] = useState<(HTMLUListElement | null)[]>([]);

  useLayoutEffect(() => {
    let current: (HTMLUListElement | null)[] = [];
    function findLists() {
      const next = popupListSelectors.map((selector) => editor.dom.querySelector<HTMLUListElement>(selector));
      if (current.length === next.length && current.every((list, index) => list === next[index])) return;
      current = next;
      setLists(next);
    }

    findLists();
    const changes = new MutationObserver(findLists);
    changes.observe(editor.dom, { childList: true, subtree: true });
    return () => changes.disconnect();
  }, [editor]);

  return lists.map((list, index) => list?.parentElement
    ? createPortal(<PopupScrollbar list={list} />, list.parentElement, popupListSelectors[index])
    : null);
}

function PopupScrollbar({ list }: { list: HTMLUListElement }) {
  const messages = useMessages();
  const viewport = useMemo(() => ({ current: list }), [list]);
  const [bounds, setBounds] = useState<ScrollBounds>();

  useLayoutEffect(() => {
    const host = list.parentElement;
    if (!host) return;
    const close = host.querySelector<HTMLButtonElement>(":scope > button[name=close]");

    function measure() {
      if (!host) return;
      const area = host.getBoundingClientRect();
      const scrollport = list.getBoundingClientRect();
      const closeInset = close ? Math.max(0, close.getBoundingClientRect().bottom - scrollport.top) : 0;
      const next = {
        top: scrollport.top - area.top - host.clientTop + closeInset,
        left: scrollport.left - area.left - host.clientLeft,
        width: scrollport.width,
        height: Math.max(0, scrollport.height - closeInset),
      };
      setBounds((previous) => previous?.top === next.top && previous.left === next.left &&
        previous.width === next.width && previous.height === next.height ? previous : next);
    }

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    resize.observe(list);
    if (close) resize.observe(close);
    return () => resize.disconnect();
  }, [list]);

  return (
    <div className="code-editor__popup-scrollbar" style={bounds}>
      <Scrollbar viewport={viewport} controls={list.id} label={messages.scrollVertically}
        orientation="vertical" focusable={false} />
    </div>
  );
}
