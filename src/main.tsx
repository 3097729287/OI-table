import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import "./theme/colors.css";
import "./theme/mint.css";
import "./theme/lavender.css";
import "./app.css";
import { WindowShell } from "./windowing/WindowShell";

document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey) return;

  // Focused editor and component shortcuts run before browser defaults are suppressed.
  const focusTraversal = event.key === "Tab" && !event.ctrlKey && !event.metaKey;
  const pageFind = event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey) && !event.shiftKey;
  if (focusTraversal || pageFind) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <WindowShell />
    </I18nProvider>
  </StrictMode>,
);
