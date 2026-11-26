import { useEffect, useState } from "react";

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

export function DelayedLoadingMessage({ children }: { children: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? <StatusMessage state="loading">{children}</StatusMessage> : null;
}
