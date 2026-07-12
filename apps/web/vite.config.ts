import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/fiber-route-doctor/",
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      // "prompt": never silently reload — a deploy mid key-mint or
      // channel-open must not wipe in-flight state. See PwaUpdatePrompt.
      registerType: "prompt",
      manifest: {
        name: "Fiber Route Doctor",
        short_name: "Route Doctor",
        description:
          "Diagnostics toolkit for CKB Fiber nodes: route diagnosis, health checks, liquidity snapshots, network map, and channel management. Demo mode works fully offline.",
        theme_color: "#0d1b2a",
        background_color: "#0d1b2a",
        display: "standalone",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,webp,png}"],
        // The biscuit wasm bundle is ~2.4 MB — above workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ]
});
