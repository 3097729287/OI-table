import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import type { DebugVariable } from "./localDebug";
import "./problem-debug-variables.css";

interface VariableContext {
  revision: number;
  scope: string;
  collapsedAt: number;
  canInspect: boolean;
  loadChildren(reference: number): Promise<readonly DebugVariable[]>;
}

interface VariablesProps extends Omit<VariableContext, "scope" | "collapsedAt"> {
  variables?: readonly DebugVariable[];
  globalsReference?: number;
  scope?: string;
}

interface ChildRequest {
  revision: number;
  reference: number;
}

interface VariableBranch {
  scope: string;
  result?: ChildRequest & { children: readonly DebugVariable[] };
  error?: ChildRequest;
}

const categoryLabels = {
  special: "problemDebugVariableSpecial",
  function: "problemDebugVariableFunctions",
  class: "problemDebugVariableClasses",
} as const;

const categories = ["special", "function", "class"] as const;

function useVariableExpansion({ scope, collapsedAt }: VariableContext) {
  const [open, setOpen] = useState<{ scope: string; collapsedAt: number }>();
  const expanded = open?.scope === scope && open.collapsedAt === collapsedAt;
  return { expanded, toggle: () => setOpen(expanded ? undefined : { scope, collapsedAt }) };
}

function variableRows(variables: readonly DebugVariable[], context: VariableContext) {
  const occurrences = new Map<string, number>();
  return variables.map((variable) => {
    const occurrence = occurrences.get(variable.name) ?? 0;
    occurrences.set(variable.name, occurrence + 1);
    return <VariableRow key={`${occurrence}:${variable.name}`} variable={variable} context={context} />;
  });
}

function VariableList({ variables, context, grouped }: {
  variables: readonly DebugVariable[];
  context: VariableContext;
  grouped?: boolean;
}) {
  return (
    <ul className="problem-debug-variable__list">
      {grouped ? categories.map((category) => {
        const members = variables.filter(({ group }) => group === category);
        return members.length > 0 && <VariableCategory key={category} category={category} variables={members} context={context} />;
      }) : null}
      {variableRows(grouped ? variables.filter(({ group }) => !group) : variables, context)}
    </ul>
  );
}

function Disclosure({ label, expanded, controls, toggle }: {
  label: string;
  expanded: boolean;
  controls: string;
  toggle(): void;
}) {
  return (
    <button type="button" className="problem-debug-variable__disclosure" aria-expanded={expanded}
      aria-controls={controls} onClick={toggle}>
      <Icon name="chevronRight" size={13} /><span>{label}</span>
    </button>
  );
}

function ScopeGroup({ label, expanded, toggle, children, id }: {
  label: string;
  expanded: boolean;
  toggle(): void;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="problem-debug-variable__scope">
      <Disclosure label={label} expanded={expanded} controls={id} toggle={toggle} />
      <div id={id} className="problem-debug-variable__branch" hidden={!expanded}>{children}</div>
    </div>
  );
}

function VariableCategory({ category, variables, context }: {
  category: (typeof categories)[number];
  variables: readonly DebugVariable[];
  context: VariableContext;
}) {
  const messages = useMessages();
  const controls = useId();
  const { expanded, toggle } = useVariableExpansion(context);
  return (
    <li className="problem-debug-variable__category">
      <Disclosure label={messages[categoryLabels[category]]} expanded={expanded} controls={controls} toggle={toggle} />
      <div id={controls} className="problem-debug-variable__branch" hidden={!expanded}>
        <VariableList variables={variables} context={{ ...context, canInspect: expanded && context.canInspect }} />
      </div>
    </li>
  );
}

function valueKind(type: string, value: string) {
  if (/^(?:str|bytes|string|std::.*string)\b/.test(type) || /^["']/.test(value)) return "string";
  if (/^(?:bool|NoneType)$/.test(type) || /^(?:True|False|None|true|false|nullptr)$/.test(value)) return "literal";
  if (/^[+-]?(?:\d[\d.eE+-]*|0x[\da-f]+)$/i.test(value)) return "number";
  return undefined;
}

function VariableRow({ variable, context }: { variable: DebugVariable; context: VariableContext }) {
  const { reference, name, value, type } = variable;
  const messages = useMessages();
  const childrenId = useId();
  const { expanded, toggle } = useVariableExpansion(context);
  const visible = reference != null && expanded;

  return (
    <li className="problem-debug__variable">
      <div className="problem-debug-variable__row">
        {reference != null ? (
          <button type="button" className="problem-debug-variable__toggle"
            aria-label={messages.problemDebugToggleVariable.replace("{name}", () => name)}
            aria-expanded={visible} aria-controls={childrenId} aria-disabled={!context.canInspect || undefined}
            onClick={() => { if (context.canInspect) toggle(); }}>
            <Icon name="chevronRight" size={13} />
          </button>
        ) : <span className="problem-debug-variable__indent" aria-hidden="true" />}
        <span className="problem-debug-variable__text" data-selectable data-variable-text data-variable-type={type || undefined}>
          <span className="problem-debug-variable__name">{name}</span>
          {value.length > 0 && <><span className="problem-debug-variable__assignment">{" = "}</span>
            <span className="problem-debug-variable__value" data-kind={valueKind(type, value)}>{value}</span></>}
        </span>
      </div>
      {reference != null && (
        <div id={childrenId} className="problem-debug-variable__branch" hidden={!visible}>
          <VariableChildren reference={reference} expanded={visible} context={context} />
        </div>
      )}
    </li>
  );
}

function VariableChildren({ reference, expanded, context, grouped }: {
  reference: number;
  expanded: boolean;
  context: VariableContext;
  grouped?: boolean;
}) {
  const { revision, scope, canInspect, loadChildren } = context;
  const messages = useMessages();
  const [branch, setBranch] = useState<VariableBranch>({ scope });
  if (branch.scope !== scope) setBranch({ scope });
  const children = branch.scope === scope ? branch.result?.children : undefined;
  const current = branch.result?.revision === revision && branch.result.reference === reference;
  const failed = branch.error?.revision === revision && branch.error.reference === reference;
  const fetchChildren = useEffectEvent(loadChildren);

  useEffect(() => {
    if (!expanded || !canInspect || current || failed) return;
    let active = true;
    const request = { revision, reference };
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const children = await fetchChildren(reference);
        if (active) setBranch((previous) => previous.scope === scope
          ? { ...previous, result: { ...request, children }, error: undefined } : previous);
      } catch {
        if (active) setBranch((previous) => previous.scope === scope ? { ...previous, error: request } : previous);
      }
    });
    return () => { active = false; };
  }, [canInspect, current, expanded, failed, reference, revision, scope]);

  return (
    <div aria-busy={expanded && !current && !failed || undefined}>
      {children && <VariableList grouped={grouped} variables={children} context={{ ...context, canInspect: expanded && canInspect && current }} />}
      {!children && !failed && <p className="problem-debug-variable__status" role="status">{messages.problemDebugInspecting}</p>}
      {current && children?.length === 0 && <p className="problem-debug-variable__status">{messages.problemDebugVariableEmpty}</p>}
      {failed && (
        <div className="problem-debug-variable__status">
          <p role="status">{messages.problemDebugVariableLoadFailed}</p>
          <button type="button" className="problem-debug-variable__retry" aria-disabled={!canInspect || undefined}
            onClick={() => { if (canInspect) setBranch((previous) => ({ ...previous, error: undefined })); }}>
            {messages.retry}
          </button>
        </div>
      )}
    </div>
  );
}

interface VariableHover {
  anchor: HTMLElement;
  revision: number;
  scope: string;
  text: string;
}

function VariableTooltip({ hover, close, hold, dismissSoon }: {
  hover: VariableHover;
  close(): void;
  hold(): void;
  dismissSoon(): void;
}) {
  const tooltip = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const popup = tooltip.current;
    if (!popup) return;
    const { anchor } = hover;
    const view = anchor.ownerDocument.documentElement;
    const rect = anchor.getBoundingClientRect();
    const inset = 8;
    const gap = 4;
    const below = view.clientHeight - rect.bottom - gap - inset;
    const above = rect.top - gap - inset;
    const preferBelow = below >= popup.offsetHeight || below >= above;
    popup.style.maxBlockSize = `${Math.max(0, preferBelow ? below : above)}px`;
    popup.style.left = `${Math.max(inset, Math.min(rect.left, view.clientWidth - popup.offsetWidth - inset))}px`;
    popup.style.top = `${preferBelow ? rect.bottom + gap : rect.top - gap - popup.offsetHeight}px`;
    anchor.setAttribute("aria-describedby", id);
    return () => anchor.removeAttribute("aria-describedby");
  }, [hover, id]);

  useEffect(() => {
    const view = hover.anchor.ownerDocument.defaultView;
    if (!view) return;
    function closeOnScroll(event: Event) {
      if (!(event.target instanceof Node && tooltip.current?.contains(event.target))) close();
    }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") close(); }
    view.addEventListener("scroll", closeOnScroll, true);
    view.addEventListener("resize", close);
    view.addEventListener("keydown", closeOnEscape);
    return () => {
      view.removeEventListener("scroll", closeOnScroll, true);
      view.removeEventListener("resize", close);
      view.removeEventListener("keydown", closeOnEscape);
    };
  }, [hover, close]);

  return createPortal(
    <ScrollArea ref={tooltip} id={id} className="problem-debug-variable-tooltip" orientation="vertical"
      role="tooltip" onPointerEnter={hold} onPointerLeave={dismissSoon}>
      <pre data-selectable>{hover.text}</pre>
    </ScrollArea>,
    hover.anchor.ownerDocument.body,
  );
}

export function ProblemDebugVariables({ variables, globalsReference, revision, scope = "", canInspect, loadChildren }: VariablesProps) {
  const messages = useMessages();
  const controls = useId();
  const [expanded, setExpanded] = useState(true);
  const [localsOpen, setLocalsOpen] = useState(true);
  const [globalsOpen, setGlobalsOpen] = useState(false);
  const [collapsedAt, setCollapsedAt] = useState(0);
  const [hover, setHover] = useState<VariableHover>();
  const timer = useRef<number | undefined>(undefined);
  const hold = useCallback(() => window.clearTimeout(timer.current), []);
  const close = useCallback(() => { hold(); setHover(undefined); }, [hold]);
  const dismissSoon = useCallback(() => {
    hold();
    timer.current = window.setTimeout(close, 140);
  }, [close, hold]);
  useEffect(() => hold, [hold]);

  function startHover(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || !(event.target instanceof HTMLElement)) return;
    const anchor = event.target.closest<HTMLElement>("[data-variable-text]");
    if (!anchor) return;
    if (hover?.anchor === anchor && hover.revision === revision && hover.scope === scope) {
      hold();
      return;
    }
    close();
    const value = anchor.textContent ?? "";
    const type = anchor.dataset.variableType;
    if (!type && !/[\r\n]/.test(value) && anchor.scrollWidth <= anchor.clientWidth) return;
    timer.current = window.setTimeout(() => {
      const rect = anchor.getBoundingClientRect();
      if (anchor.isConnected && rect.bottom > 0 && rect.top < anchor.ownerDocument.documentElement.clientHeight) {
        setHover({ anchor, revision, scope, text: type ? `${value}\n${type}` : value });
      }
    }, 300);
  }

  function endHover(event: PointerEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("[data-variable-text]")) dismissSoon();
  }

  const context = { revision, scope, collapsedAt, canInspect: expanded && canInspect, loadChildren };

  function collapseAll() {
    close();
    setLocalsOpen(false);
    setGlobalsOpen(false);
    setCollapsedAt((previous) => previous + 1);
  }

  return (
    <div className="problem-debug__variables" onPointerOver={startHover} onPointerOut={endHover}>
      <div className="problem-debug-variable__heading">
        <h3><Disclosure label={messages.problemDebugVariables} expanded={expanded} controls={controls}
          toggle={() => { close(); setExpanded(!expanded); }} /></h3>
        <button type="button" className="problem-debug-variable__collapse" title={messages.problemDebugVariableCollapseAll}
          aria-label={messages.problemDebugVariableCollapseAll} onClick={collapseAll}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3h8v8H5zM3 5v8h8M7.5 7h3" />
          </svg>
        </button>
      </div>
      <div id={controls} className="problem-debug-variable__scopes" hidden={!expanded}>
        <ScopeGroup label={messages.problemDebugVariableLocals} expanded={localsOpen} id={`${controls}-locals`}
          toggle={() => { close(); setLocalsOpen(!localsOpen); }}>
          {variables && <VariableList grouped variables={variables} context={{ ...context, canInspect: context.canInspect && localsOpen }} />}
          {variables?.length === 0 && <p className="problem-debug-variable__status">{messages.problemDebugNoVariables}</p>}
        </ScopeGroup>
        {globalsReference != null && (
          <ScopeGroup label={messages.problemDebugVariableGlobals} expanded={globalsOpen} id={`${controls}-globals`}
            toggle={() => { close(); setGlobalsOpen(!globalsOpen); }}>
            <VariableChildren grouped reference={globalsReference} expanded={globalsOpen} context={context} />
          </ScopeGroup>
        )}
      </div>
      {hover?.revision === revision && hover.scope === scope && hover.anchor.isConnected && (
        <VariableTooltip hover={hover} close={close} hold={hold} dismissSoon={dismissSoon} />
      )}
    </div>
  );
}
