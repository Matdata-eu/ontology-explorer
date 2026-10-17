import { defineConfig } from "vite";

// The app build: everything the static site and the embedded `serve` viewer need.
// ELK and the WASM parser live in their own workers, so the main bundle stays small.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  worker: { format: "es" },
  server: { port: 5173 },
});
