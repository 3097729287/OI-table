import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { WindowShell } from "./windowing/WindowShell";

document.addEventListener("contextmenu", (event) => event.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WindowShell />
  </StrictMode>,
);
