// Getting a bundle from somewhere: a URL, dropped files, or the local server.
import type { Bundle } from "./model";

export interface LoadProgress {
  stage: "download" | "parse" | "index";
  detail?: string;
  loaded?: number;
  total?: number;
}

export interface ServerStatus {
  server: boolean;
  version?: string;
  loaded?: boolean;
  title?: string;
  relay?: boolean;
  maxUploadBytes?: number;
}

const RDF_EXT = /\.(ttl|turtle|nt|ntriples|trig|nq|nquads|rdf|owl|xml|jsonld)(\.gz)?$/i;

export function looksLikeRdf(name: string): boolean {
  return RDF_EXT.test(name);
}

/** Where the viewer is served from; API calls are relative to it. */
export function baseUrl(): string {
  const u = new URL(".", document.baseURI);
  return u.href;
}

export async function serverStatus(): Promise<ServerStatus | null> {
  try {
    const r = await fetch(new URL("api/status", baseUrl()), { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as ServerStatus;
    return j.server ? j : null;
  } catch {
    return null;
  }
}

export async function fetchBundleFromServer(): Promise<Bundle> {
  const r = await fetch(new URL("api/bundle", baseUrl()), { cache: "no-store" });
  if (!r.ok) throw new Error(`server has no bundle (${r.status})`);
  return checkBundle(await r.json());
}

/** Load a URL: a bundle (JSON) or raw RDF (parsed in the browser). */
export async function loadUrl(url: string, progress?: (p: LoadProgress) => void, opts: { relay?: boolean; title?: string } = {}): Promise<Bundle> {
  const abs = new URL(url, document.baseURI).href;
  progress?.({ stage: "download", detail: abs });
  let resp: Response;
  try {
    resp = await fetch(abs, { headers: { Accept: "application/json, text/turtle;q=0.9, application/rdf+xml;q=0.8, */*;q=0.5" } });
  } catch (e) {
    if (opts.relay) {
      resp = await fetch(new URL(`api/fetch?url=${encodeURIComponent(abs)}`, baseUrl()));
      if (!resp.ok) throw new Error(`cannot fetch ${abs} through the server: ${await resp.text()}`);
      const name = resp.headers.get("x-file-name") ?? nameOf(abs);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return parseFiles([{ name, bytes }], progress, opts.title);
    }
    throw new Error(`cannot fetch ${abs}: ${String((e as Error).message || e)}. The host may not allow cross-origin requests; download the file and drop it here instead.`);
  }
  if (!resp.ok) throw new Error(`cannot fetch ${abs}: HTTP ${resp.status}`);
  const ctype = (resp.headers.get("content-type") ?? "").toLowerCase();
  const name = nameOf(abs);
  const isJson = ctype.includes("application/json") || /\.json(\.gz)?$/i.test(name);
  const bytes = await readWithProgress(resp, progress);
  if (isJson && !/\.jsonld$/i.test(name)) {
    const text = new TextDecoder().decode(maybeGunzip(bytes, name));
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "entities" in parsed) return checkBundle(parsed);
    // A JSON file that is not a bundle: try it as JSON-LD.
    return parseFiles([{ name: name.replace(/\.json$/i, ".jsonld"), bytes }], progress, opts.title);
  }
  return parseFiles([{ name, bytes }], progress, opts.title);
}

function nameOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    const last = p.split("/").filter(Boolean).pop();
    return last && last.includes(".") ? last : (last ?? "file") + ".ttl";
  } catch {
    return "file.ttl";
  }
}

async function readWithProgress(resp: Response, progress?: (p: LoadProgress) => void): Promise<Uint8Array> {
  const total = Number(resp.headers.get("content-length") ?? 0) || undefined;
  if (!resp.body || !progress) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress({ stage: "download", loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function maybeGunzip(bytes: Uint8Array, _name: string): Uint8Array {
  // Browsers decode Content-Encoding: gzip themselves; a literal .gz file would
  // need DecompressionStream, handled asynchronously in parseFiles.
  return bytes;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

let wasmWorker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (json: string) => void; reject: (e: Error) => void; progress?: (p: LoadProgress) => void }>();

function worker(): Worker {
  if (!wasmWorker) {
    wasmWorker = new Worker(new URL("./wasm.worker.ts", import.meta.url), { type: "module" });
    wasmWorker.onmessage = (ev: MessageEvent<{ id: number; json?: string; error?: string; ms?: number }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.json as string);
    };
    wasmWorker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "the parser could not start"));
      pending.clear();
      wasmWorker = null;
    };
  }
  return wasmWorker;
}

/** Parse RDF files in the browser (WebAssembly) and build the bundle. */
export async function parseFiles(files: NamedBytes[], progress?: (p: LoadProgress) => void, title?: string): Promise<Bundle> {
  const prepared: NamedBytes[] = [];
  for (const f of files) {
    const gz = f.name.toLowerCase().endsWith(".gz") || (f.bytes[0] === 0x1f && f.bytes[1] === 0x8b);
    prepared.push(gz ? { name: f.name.replace(/\.gz$/i, ""), bytes: await gunzip(f.bytes) } : f);
  }
  progress?.({ stage: "parse", detail: prepared.map((f) => f.name).join(", ") });
  const id = ++seq;
  const json = await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    const contents = prepared.map((f) => f.bytes);
    worker().postMessage({ id, names: prepared.map((f) => f.name), contents, title }, contents.map((c) => c.buffer as ArrayBuffer));
  });
  progress?.({ stage: "index" });
  return checkBundle(JSON.parse(json));
}

/** Ask the local server to parse the files (for very large inputs, or when WASM is unavailable). */
export async function parseOnServer(files: NamedBytes[], keep: boolean, title?: string): Promise<Bundle> {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const h1 = new Uint8Array(4);
    new DataView(h1.buffer).setUint32(0, name.length, true);
    const h2 = new Uint8Array(4);
    new DataView(h2.buffer).setUint32(0, f.bytes.length, true);
    parts.push(h1, name, h2, f.bytes);
  }
  const body = new Blob(parts as BlobPart[]);
  const q = new URLSearchParams({ name: files[0]?.name ?? "upload", keep: keep ? "1" : "0" });
  if (title) q.set("title", title);
  const r = await fetch(new URL(`api/build?${q}`, baseUrl()), { method: "POST", body });
  if (!r.ok) throw new Error(await r.text());
  return checkBundle(await r.json());
}

export async function readFiles(list: FileList | File[]): Promise<NamedBytes[]> {
  const out: NamedBytes[] = [];
  for (const f of Array.from(list)) out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

function checkBundle(b: unknown): Bundle {
  const x = b as Bundle;
  if (!x || typeof x !== "object" || !Array.isArray(x.entities)) throw new Error("this is not an ontology-explorer bundle");
  if (x.format !== 1) throw new Error(`bundle format ${x.format} is not supported by this viewer (expected 1)`);
  return x;
}
