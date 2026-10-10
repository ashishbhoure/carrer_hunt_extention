import { defineConfig } from "vite";
import { resolve } from "node:path";

// The content script is injected on demand via chrome.scripting.executeScript, which needs a
// classic (non-module) self-contained script, so it is built separately as an IIFE.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: resolve(__dirname, "src/content/index.ts"), formats: ["iife"], name: "CareerPilotContent", fileName: () => "content.js" },
  },
});
