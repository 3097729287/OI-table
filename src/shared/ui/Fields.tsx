import { useRef, type ComponentProps, type ReactNode, type Ref } from "react";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import "./fields.css";

export { Select } from "./Select";

type InputProps = Omit<ComponentProps<"input">, "children">;
type InputFieldProps = InputProps & { controls?: ReactNode; rootRef?: Ref<HTMLSpanElement> };

function InputField({ className, type = "text", controls, rootRef, ...props }: InputFieldProps) {
  return (
    <span ref={rootRef} className={className ? `ui-field ui-input ${className}` : "ui-field ui-input"}>
      <input data-selectable {...props} type={type} className="ui-input__control" />
      {controls}
    </span>
  );
}

export function Input(props: InputProps) {
  return <InputField {...props} />;
}

export function NumberInput(props: Omit<InputProps, "type">) {
  const field = useRef<HTMLSpanElement>(null);

  function stepValue(direction: -1 | 1) {
    const input = field.current?.querySelector("input");
    if (!input || input.disabled || input.readOnly || input.step === "any") return;

    const previous = input.value;
    if (direction < 0) input.stepDown();
    else input.stepUp();
    input.focus({ preventScroll: true });
    if (input.value !== previous) input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const stepsDisabled = props.disabled || props.readOnly;
  const controls = props.step !== "any" && (
    <span className="ui-input__steps">
      <button type="button" tabIndex={-1} disabled={stepsDisabled} aria-label={t("increaseValue")}
        onMouseDown={(event) => event.preventDefault()} onClick={() => stepValue(1)}>
        <Icon name="chevronRight" size={12} />
      </button>
      <button type="button" tabIndex={-1} disabled={stepsDisabled} aria-label={t("decreaseValue")}
        onMouseDown={(event) => event.preventDefault()} onClick={() => stepValue(-1)}>
        <Icon name="chevronRight" size={12} />
      </button>
    </span>
  );

  return <InputField {...props} type="number" rootRef={field} controls={controls} />;
}
