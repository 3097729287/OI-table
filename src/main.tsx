import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { locale } from "./i18n";
import "./app.css";
import { WindowShell } from "./windowing/WindowShell";

document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WindowShell />
  </StrictMode>,
);
