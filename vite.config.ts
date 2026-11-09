import { defineConfig } from "vite";

// The frontend lives in ./ui and is built to ./dist, which Tauri bundles.
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: {
    // Loopback only: the dev server is never reachable from your network.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true, // only ever empties ./dist inside this project
    target: "es2022",
    sourcemap: false,
  },
});
