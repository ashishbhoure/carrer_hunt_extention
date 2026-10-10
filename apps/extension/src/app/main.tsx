import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../ui/styles.css";
import { App } from "./App";
import { ToastProvider } from "../ui/kit";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ToastProvider>
  </React.StrictMode>,
);
