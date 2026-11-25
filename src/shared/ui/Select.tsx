import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { ScrollArea } from "./ScrollArea";
import "./fields.css";

type SelectOption<Value extends string> = {
  value: Value;
  label: string;
  disabled?: boolean;
};

type SelectProps<Value extends string> = Pick<
  ComponentProps<"button">,
  "id" | "disabled" | "className" | "title" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"
> & {
  value: Value;
  options: readonly SelectOption<Value>[];
  triggerLabel?: string;
  onValueChange: (value: Value) => void;
};

const popupGap = 4;
const popupMinWidth = 140;
const popupHeightLimit = 240;

function positionPopup(trigger: HTMLButtonElement, popup: HTMLDivElement, viewport: HTMLDivElement) {
  const anchor = trigger.getBoundingClientRect();
  const width = Math.min(Math.max(anchor.width, popupMinWidth), Math.max(0, window.innerWidth - 2 * popupGap));
  const left = Math.max(popupGap, Math.min(anchor.left, window.innerWidth - width - popupGap));
  popup.style.width = `${width}px`;
  popup.style.left = `${left}px`;

  const below = Math.max(0, window.innerHeight - anchor.bottom - 2 * popupGap);
  const above = Math.max(0, anchor.top - 2 * popupGap);
  const naturalHeight = Math.min(popupHeightLimit, viewport.scrollHeight + popup.offsetHeight - viewport.clientHeight);
  const opensAbove = naturalHeight > below && above > below;
  popup.style.maxHeight = `${Math.min(popupHeightLimit, opensAbove ? above : below)}px`;
  popup.style.top = `${opensAbove ? anchor.top - popupGap - popup.offsetHeight : anchor.bottom + popupGap}px`;
}

export function Select<Value extends string>({
  value,
  options,
  onValueChange,
  className,
  triggerLabel,
  id,
  disabled,
  ...accessibleProps
}: SelectProps<Value>) {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const popupId = `${generatedId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const showPopup = isOpen && !disabled;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const activeOption = options[activeIndex];

  useLayoutEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    const viewport = viewportRef.current;
    if (!showPopup || !trigger || !popup || !viewport) return;
    positionPopup(trigger, popup, viewport);
  }, [showPopup, options]);

  useLayoutEffect(() => {
    if (!showPopup) return;
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    const close = () => setIsOpen(false);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!trigger?.contains(event.target) && !popup?.contains(event.target)) close();
    };
    const closeOnOutsideScroll = (event: Event) => {
      if (event.target instanceof Node && !popup?.contains(event.target)) close();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("scroll", closeOnOutsideScroll, { capture: true, passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("scroll", closeOnOutsideScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [showPopup]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const item = document.getElementById(`${popupId}-${activeIndex}`);
    if (!viewport || !item) return;

    const itemBounds = item.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const top = viewportBounds.top + viewport.clientTop;
    const bottom = top + viewport.clientHeight;
    if (itemBounds.top < top) viewport.scrollTop += itemBounds.top - top;
    else if (itemBounds.bottom > bottom) viewport.scrollTop += itemBounds.bottom - bottom;
  }, [showPopup, activeIndex, options, popupId]);

  function findEnabledIndex(from: number, step: 1 | -1) {
    for (let index = from + step; index >= 0 && index < options.length; index += step) {
      if (!options[index].disabled) return index;
    }
    return -1;
  }

  function open(backward = false) {
    const initialIndex = backward ? options.length : -1;
    const hasEnabledSelection = selectedIndex >= 0 && !options[selectedIndex].disabled;
    triggerRef.current?.focus({ preventScroll: true });
    setActiveIndex(hasEnabledSelection ? selectedIndex : findEnabledIndex(initialIndex, backward ? -1 : 1));
    setIsOpen(true);
  }

  function select(option: SelectOption<Value> | undefined) {
    if (!option || option.disabled) return;
    setIsOpen(false);
    if (option.value !== value) onValueChange(option.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const backward = event.key === "ArrowUp";
        if (!showPopup) {
          open(backward);
          break;
        }
        const index = activeIndex >= 0 ? activeIndex : backward ? options.length : -1;
        const next = findEnabledIndex(index, backward ? -1 : 1);
        if (next >= 0) setActiveIndex(next);
        break;
      }
      case "Home":
      case "End":
        if (showPopup) {
          event.preventDefault();
          setActiveIndex(event.key === "Home" ? findEnabledIndex(-1, 1) : findEnabledIndex(options.length, -1));
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (event.repeat) break;
        if (showPopup) select(activeOption);
        else open();
        break;
      case "Escape":
        if (showPopup) {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
        }
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  }

  return (
    <>
      <button
        {...accessibleProps}
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        disabled={disabled}
        className={className ? `ui-field ui-select ${className}` : "ui-field ui-select"}
        aria-haspopup="listbox"
        aria-expanded={showPopup}
        aria-controls={showPopup ? popupId : undefined}
        aria-activedescendant={showPopup && activeOption && !activeOption.disabled ? `${popupId}-${activeIndex}` : undefined}
        onBlur={() => setIsOpen(false)}
        onClick={(event) => {
          event.currentTarget.focus();
          if (showPopup) setIsOpen(false);
          else open();
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="ui-select__label">{triggerLabel ?? options[selectedIndex]?.label}</span>
        <span className="ui-select__chevron">
          <Icon name="chevronRight" size={14} />
        </span>
      </button>
      {showPopup && createPortal(
        <ScrollArea
          ref={popupRef}
          viewportRef={viewportRef}
          id={popupId}
          role="listbox"
          aria-label={accessibleProps["aria-label"]}
          aria-labelledby={accessibleProps["aria-labelledby"] ?? (accessibleProps["aria-label"] ? undefined : triggerId)}
          className="ui-select-popup"
          orientation="vertical"
          focusScrollbar={false}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${popupId}-${index}`}
              className="ui-select__option"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={activeIndex === index || undefined}
              onPointerMove={() => !option.disabled && setActiveIndex(index)}
              onClick={() => select(option)}
            >
              {option.label}
            </div>
          ))}
        </ScrollArea>,
        document.body,
      )}
    </>
  );
}
