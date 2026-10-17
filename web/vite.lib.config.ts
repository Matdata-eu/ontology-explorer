import { defineConfig } from "vite";

// The library build: the <ontology-explorer> web component as one ES module
// (workers and the WASM file are emitted next to it).
export default defineConfig({
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: "src/lib.ts",
      formats: ["es"],
      fileName: () => "ontology-explorer.js",
    },
    rollupOptions: { output: { inlineDynamicImports: false } },
  },
  worker: { format: "es" },
});
