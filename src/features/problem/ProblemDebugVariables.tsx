import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import "../../shared/ui/floating-surface.css";
import type { DebugVariable } from "./localDebug";
import "./problem-debug-variables.css";

interface VariableContext {
  revision: number;
  valueRevision: number;
  scope: string;
  collapsedAt: number;
  canInspect: boolean;
  loadChildren(reference: number): Promise<readonly DebugVariable[]>;
}

interface VariablesProps extends Omit<VariableContext, "scope" | "collapsedAt" | "valueRevision"> {
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
  const controls = useId();
  const { expanded, toggle } = useVariableExpansion(context);
  return (
    <li className="problem-debug-variable__category">
      <Disclosure label={t(categoryLabels[category])} expanded={expanded} controls={controls} toggle={toggle} />
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

interface VariableObservation {
  scope: string;
  revision: number;
  value: string;
  type: string;
  previous?: { value: string; type: string };
}

function VariableRow({ variable, context }: { variable: DebugVariable; context: VariableContext }) {
  const { reference, name, value, type } = variable;
  const { scope, valueRevision } = context;
  const [observed, setObserved] = useState<VariableObservation>({ scope, revision: valueRevision, value, type });
  if (observed.scope !== scope || observed.revision !== valueRevision) {
    const comparable = observed.scope === scope && observed.revision + 1 === valueRevision;
    const previous = comparable && (observed.value !== value || observed.type !== type)
      ? { value: observed.value, type: observed.type } : undefined;
    setObserved({ scope, revision: valueRevision, value, type, previous });
  }
  const previous = variable.previous ?? observed.previous;
  const typeDescription = previous?.type && previous.type !== type ? `${previous.type} → ${type || "?"}` : type;
  const change = previous && [`${name} = ${previous.value || '""'} → ${value || '""'}`, typeDescription]
    .filter(Boolean).join("\n");
  const childrenId = useId();
  const { expanded, toggle } = useVariableExpansion(context);
  const visible = reference != null && expanded;
  const canToggle = reference != null && context.canInspect;

  return (
    <li className="problem-debug__variable">
      <div className="problem-debug-variable__row" data-expandable={canToggle || undefined}
        onClick={canToggle ? (event) => {
          const arrow = event.target instanceof Element && event.target.closest("button");
          if (event.detail > 0 && !arrow) {
            const selection = event.currentTarget.ownerDocument.getSelection();
            if (selection && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(event.currentTarget)) return;
          }
          toggle();
        } : undefined}>
        {reference != null ? (
          <button type="button" className="problem-debug-variable__toggle"
            aria-label={t("problemDebugToggleVariable", { name })}
            aria-expanded={visible} aria-controls={childrenId} aria-disabled={!canToggle || undefined}>
            <Icon name="chevronRight" size={13} />
          </button>
        ) : <span className="problem-debug-variable__indent" aria-hidden="true" />}
        <span className="problem-debug-variable__text" data-selectable data-variable-text data-variable-type={type || undefined}
          data-variable-change={change}>
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
  const [branch, setBranch] = useState<VariableBranch>({ scope });
  if (branch.scope !== scope) setBranch({ scope });
  const result = branch.scope === scope ? branch.result : undefined;
  const children = result?.children;
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
      {result && <VariableList grouped={grouped} variables={result.children}
        context={{ ...context, valueRevision: result.revision, canInspect: expanded && canInspect && current }} />}
      {!children && !failed && <p className="problem-debug-variable__status" role="status">{t("problemDebugInspecting")}</p>}
      {current && children?.length === 0 && <p className="problem-debug-variable__status">{t("problemDebugVariableEmpty")}</p>}
      {failed && (
        <div className="problem-debug-variable__status">
          <p role="status">{t("problemDebugVariableLoadFailed")}</p>
          <button type="button" className="problem-debug-variable__retry" aria-disabled={!canInspect || undefined}
            onClick={() => { if (canInspect) setBranch((previous) => ({ ...previous, error: undefined })); }}>
            {t("retry")}
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
  const hoverBridge = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const popup = tooltip.current;
    const bridge = hoverBridge.current;
    if (!popup || !bridge) return;
    const { anchor } = hover;
    const view = anchor.ownerDocument.documentElement;
    const rect = anchor.getBoundingClientRect();
    const inset = 8;
    const gap = 4;
    const below = view.clientHeight - rect.bottom - gap - inset;
    const above = rect.top - gap - inset;
    const preferBelow = below >= popup.offsetHeight || below >= above;
    popup.style.maxBlockSize = `${Math.max(0, preferBelow ? below : above)}px`;
    const left = Math.max(inset, Math.min(rect.left, view.clientWidth - popup.offsetWidth - inset));
    popup.style.left = `${left}px`;
    popup.style.top = `${preferBelow ? rect.bottom + gap : rect.top - gap - popup.offsetHeight}px`;
    popup.style.transformOrigin = preferBelow ? "left top" : "left bottom";

    const bridgeLeft = Math.max(0, Math.min(rect.left, left));
    const bridgeRight = Math.min(view.clientWidth, Math.max(rect.right, left + popup.offsetWidth));
    bridge.style.left = `${bridgeLeft}px`;
    bridge.style.top = `${preferBelow ? rect.bottom : rect.top - gap}px`;
    bridge.style.width = `${bridgeRight - bridgeLeft}px`;
    bridge.style.height = `${gap}px`;
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
    <>
      <div ref={hoverBridge} className="problem-debug-variable-tooltip-bridge" aria-hidden="true"
        onPointerEnter={hold} onPointerLeave={dismissSoon} />
      <ScrollArea ref={tooltip} id={id} className="floating-surface problem-debug-variable-tooltip" orientation="vertical"
        role="tooltip" onPointerEnter={hold} onPointerLeave={dismissSoon}>
        <pre data-selectable>{hover.text}</pre>
      </ScrollArea>
    </>,
    hover.anchor.ownerDocument.body,
  );
}

export function ProblemDebugVariables({ variables, globalsReference, revision, scope = "", canInspect, loadChildren }: VariablesProps) {
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
    if (!anchor.dataset.variableChange && !type && !/[\r\n]/.test(value) && anchor.scrollWidth <= anchor.clientWidth) return;
    timer.current = window.setTimeout(() => {
      const rect = anchor.getBoundingClientRect();
      if (anchor.isConnected && rect.bottom > 0 && rect.top < anchor.ownerDocument.documentElement.clientHeight) {
        const text = anchor.dataset.variableChange ?? [anchor.textContent, anchor.dataset.variableType].filter(Boolean).join("\n");
        setHover({ anchor, revision, scope, text });
      }
    }, 300);
  }

  function endHover(event: PointerEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("[data-variable-text]")) dismissSoon();
  }

  const context = { revision, valueRevision: revision, scope, collapsedAt, canInspect: expanded && canInspect, loadChildren };

  function collapseAll() {
    close();
    setLocalsOpen(false);
    setGlobalsOpen(false);
    setCollapsedAt((previous) => previous + 1);
  }

  return (
    <div className="problem-debug__variables" onPointerOver={startHover} onPointerOut={endHover}>
      <div className="problem-debug-variable__heading">
        <h3><Disclosure label={t("problemDebugVariables")} expanded={expanded} controls={controls}
          toggle={() => { close(); setExpanded(!expanded); }} /></h3>
        <button type="button" className="problem-debug-variable__collapse" title={t("problemDebugVariableCollapseAll")}
          aria-label={t("problemDebugVariableCollapseAll")} onClick={collapseAll}>
          <Icon name="collapseAll" size={14} />
        </button>
      </div>
      <div id={controls} className="problem-debug-variable__scopes" hidden={!expanded}>
        <ScopeGroup label={t("problemDebugVariableLocals")} expanded={localsOpen} id={`${controls}-locals`}
          toggle={() => { close(); setLocalsOpen(!localsOpen); }}>
          {variables && <VariableList grouped variables={variables} context={{ ...context, canInspect: context.canInspect && localsOpen }} />}
          {variables?.length === 0 && <p className="problem-debug-variable__status">{t("problemDebugNoVariables")}</p>}
        </ScopeGroup>
        {globalsReference != null && (
          <ScopeGroup label={t("problemDebugVariableGlobals")} expanded={globalsOpen} id={`${controls}-globals`}
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
