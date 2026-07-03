import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
export default defineConfig({ base: "/fiber-route-doctor/", plugins: [react(), wasm(), topLevelAwait()] });
