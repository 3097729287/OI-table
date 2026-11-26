import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/colors.css";
import "./theme/mint.css";
import "./theme/lavender.css";
import "./app.css";
import { WindowShell } from "./windowing/WindowShell";

document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  // Let editor keybindings handle Tab before suppressing the browser's focus traversal.
  if (!event.defaultPrevented && event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WindowShell />
  </StrictMode>,
);
