import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TitleBar } from "./TitleBar";

function App() {
  return (
    <>
      <TitleBar />
      <main />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
