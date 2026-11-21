import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TitleBar } from "./TitleBar";
import { locale, messages } from "./i18n";
import "./app.css";

function App() {
  return (
    <>
      <TitleBar />
      <main className="workspace">
        <h1>{messages.helloWorld}</h1>
      </main>
    </>
  );
}

document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
