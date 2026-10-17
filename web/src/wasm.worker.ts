// Parses RDF files with the Rust core compiled to WebAssembly, off the main thread.
import init, { build_bundle } from "./wasm/ontology_explorer_wasm.js";
import wasmUrl from "./wasm/ontology_explorer_wasm_bg.wasm?url";

interface Req {
  id: number;
  names: string[];
  contents: Uint8Array[];
  title?: string;
}

let ready: Promise<unknown> | null = null;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, names, contents, title } = ev.data;
  try {
    if (!ready) ready = init({ module_or_path: wasmUrl });
    await ready;
    const started = performance.now();
    const json = build_bundle(names, contents, title ?? null);
    (self as unknown as Worker).postMessage({ id, json, ms: performance.now() - started });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String(e) });
  }
};
