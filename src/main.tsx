import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/cascadia-code/400.css";
import "./styles/tokens.css";
import "./styles/reset.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// xterm 5.5.0 has a race where Viewport.syncScrollArea fires via setTimeout
// before the DOM renderer's _renderer is attached, causing a benign TypeError.
// The terminal renders and functions correctly. Suppress to keep the console clean.
window.addEventListener("error", (e) => {
  if (e.message?.includes("Cannot read properties of undefined (read 'dimensions')")) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
