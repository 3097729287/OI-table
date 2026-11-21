type StatusMessageProps = {
  state: "empty" | "loading" | "error";
  children: string;
};

export function StatusMessage({ state, children }: StatusMessageProps) {
  return (
    <p
      className={`status-message status-message--${state}`}
      role={state === "error" ? "alert" : "status"}
      data-selectable={state === "error" ? true : undefined}
    >
      {children}
    </p>
  );
}
