import React from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import { Popup } from "./Popup";
import { ToastProvider } from "../ui/kit";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <Popup />
    </ToastProvider>
  </React.StrictMode>,
);
