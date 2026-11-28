import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { installKeybindings } from "./shared/keybindings";
import "./theme/colors.css";
import "./theme/code-syntax.css";
import "./theme/mint.css";
import "./theme/lavender.css";
import "./app.css";
import { WindowShell } from "./windowing/WindowShell";

document.addEventListener("contextmenu", (event) => event.preventDefault());
const uninstallKeybindings = installKeybindings(document);
import.meta.hot?.dispose(uninstallKeybindings);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <WindowShell />
    </I18nProvider>
  </StrictMode>,
);
