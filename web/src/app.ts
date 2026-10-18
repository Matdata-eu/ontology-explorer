// The application: state, routing, the shell around the views.
import type { AppCtx, Prefs, Route } from "./ctx";
import { button, copyText, h, icon, type Child } from "./dom";
import { fetchBundleFromServer, loadUrl, looksLikeRdf, parseFiles, parseOnServer, readFiles, serverStatus, type LoadProgress, type ServerStatus } from "./loader";
import { Model, type Bundle, type Id } from "./model";
import { matdataMark } from "./logo";
import { openAbout, openHelp } from "./views/dialogs";
import { classPage } from "./views/classPage";
import { homePage } from "./views/home";
import { conceptPage, genericPage, propertyPage, schemePage, shapePage } from "./views/otherPages";
import { overviewPage } from "./views/overview";
import { sidebar, type Sidebar } from "./views/sidebar";

export interface AppOptions {
  /** Route through location.hash (standalone app) or keep routes internal (embedded component). */
  routing: boolean;
  embed: boolean;
  lang?: string;
  theme?: Prefs["theme"];
  /** Fired on navigation, for hosts. */
  onNavigate?: (iri: string | null, route: Route) => void;
  onLoaded?: (bundle: Bundle) => void;
  onError?: (err: Error) => void;
  /** Where example bundles are listed (a JSON file next to the app). */
  examplesUrl?: string;
  /** Hide the sidebar and top bar; show only the entity page. */
  minimal?: boolean;
}

const DEFAULT_PREFS: Prefs = {
  lang: "",
  theme: "auto",
  showInherited: false,
  showHidden: false,
  depth: 1,
  direction: "DOWN",
  attributes: "focus",
  incoming: true,
  schemes: true,
};

export class App implements AppCtx {
  readonly root: HTMLElement;
  private opts: AppOptions;
  private shellEl: HTMLElement;
  private mainEl: HTMLElement;
  private topbar: HTMLElement;
  private side: Sidebar | null = null;
  private bodyEl: HTMLElement;
  private model: Model | null = null;
  private _route: Route = { view: "home", params: {} };
  private _prefs: Prefs;
  private server: ServerStatus | null = null;
  private toastEl: HTMLElement | null = null;
  /** Where the model came from: a URL (shareable), local files, or the server. */
  private source: { kind: "url"; url: string } | { kind: "files" } | { kind: "server" } | null = null;
  private onHash = () => this.readHash();

  constructor(root: HTMLElement, opts: AppOptions) {
    this.root = root;
    this.opts = opts;
    this._prefs = { ...DEFAULT_PREFS, ...loadPrefs() };
    if (opts.lang) this._prefs.lang = opts.lang;
    if (opts.theme) this._prefs.theme = opts.theme;
    if (opts.routing) {
      const lang = new URLSearchParams(location.search).get("lang");
      if (lang !== null) this._prefs.lang = lang;
    }
    this.topbar = h("div", { class: "topbar" });
    this.mainEl = h("div", { class: "main" }, h("div", { class: "main-inner" }));
    this.bodyEl = h("div", { class: "body no-sidebar" }, this.mainEl);
    this.shellEl = h("div", { class: `shell${opts.embed ? " embed" : ""}` }, opts.minimal ? null : this.topbar, this.bodyEl);
    root.appendChild(this.shellEl);
    this.applyTheme();
    this.renderTopbar();
    if (opts.routing) window.addEventListener("hashchange", this.onHash);
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "/" && !(ev.target instanceof HTMLInputElement) && !(ev.target instanceof HTMLTextAreaElement)) {
        ev.preventDefault();
        this.side?.focusSearch();
      }
    });
    this.wireDrop();
  }

  destroy(): void {
    window.removeEventListener("hashchange", this.onHash);
  }

  // ---- AppCtx -------------------------------------------------------------
  get m(): Model {
    if (!this.model) throw new Error("nothing loaded");
    return this.model;
  }
  get route(): Route {
    return this._route;
  }
  get prefs(): Prefs {
    return this._prefs;
  }
  get embed(): boolean {
    return this.opts.embed;
  }
  get loaded(): boolean {
    return this.model !== null;
  }
  get bundle(): Bundle | null {
    return this.model?.b ?? null;
  }

  go(id: Id, extra: Partial<Route> = {}): void {
    this.goRoute({ view: "entity", id, tab: extra.tab, params: extra.params ?? {} });
  }

  goRoute(r: Partial<Route>): void {
    const route: Route = { view: r.view ?? "home", id: r.id, tab: r.tab, query: r.query, params: r.params ?? {} };
    if (this.opts.routing) {
      const hash = this.hashFor(route);
      if (location.hash !== hash) {
        location.hash = hash; // triggers hashchange → readHash → render
        return;
      }
    }
    this.setRoute(route);
  }

  href(id: Id, extra: Partial<Route> = {}): string {
    return this.hrefRoute({ view: "entity", id, tab: extra.tab, params: extra.params });
  }

  hrefRoute(r: Partial<Route>): string {
    return this.hashFor({ view: r.view ?? "home", id: r.id, tab: r.tab, query: r.query, params: r.params ?? {} });
  }

  setPrefs(p: Partial<Prefs>): void {
    Object.assign(this._prefs, p);
    savePrefs(this._prefs);
    if (p.theme !== undefined) this.applyTheme();
    if (p.lang !== undefined && this.model) {
      this.model.lang = p.lang;
      this.rebuildSidebar();
      this.render();
    }
  }

  setParams(p: Record<string, string | undefined>): void {
    const params = { ...this._route.params };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === "") delete params[k];
      else params[k] = v;
    }
    this._route = { ...this._route, params };
    // Keep the address bar in step without a navigation, so it can always be shared.
    if (this.opts.routing) history.replaceState(history.state, "", this.hashFor(this._route));
  }

  /** A link that opens the model and the current view, as far as it can be shared. */
  shareLink(): { url: string; complete: boolean } {
    const u = new URL(location.href);
    u.hash = this.hashFor(this._route);
    if (this.source?.kind === "url") u.searchParams.set("src", this.source.url);
    else u.searchParams.delete("src");
    if (this.model && this._prefs.lang) u.searchParams.set("lang", this._prefs.lang);
    else u.searchParams.delete("lang");
    return { url: u.toString(), complete: this.source?.kind !== "files" };
  }

  private async share(): Promise<void> {
    const { url, complete } = this.shareLink();
    const ok = await copyText(url);
    if (!ok) {
      window.prompt("Copy this link", url);
      return;
    }
    this.toast(complete ? "Link to this view copied" : "Link copied. It opens this view only where the same files are loaded: files from your computer are not part of it.");
  }

  toast(msg: string): void {
    this.toastEl?.remove();
    this.toastEl = h("div", { class: "toast" }, msg);
    this.shellEl.appendChild(this.toastEl);
    setTimeout(() => this.toastEl?.remove(), msg.length > 60 ? 5000 : 2200);
  }

  refresh(): void {
    this.render();
  }

  // ---- routing ------------------------------------------------------------
  private hashFor(r: Route): string {
    const q = new URLSearchParams();
    if (r.tab) q.set("tab", r.tab);
    for (const [k, v] of Object.entries(r.params)) if (v) q.set(k, v);
    const qs = q.toString();
    let path = "#/";
    if (r.view === "entity" && r.id !== undefined && this.model) path = "#/e/" + encodeURIComponent(this.model.entity(r.id).iri);
    else if (r.view !== "home") path = "#/" + r.view;
    return path + (qs ? "?" + qs : "");
  }

  private parseHash(hash: string): Route {
    const [path, qs] = hash.replace(/^#/, "").split("?");
    const params: Record<string, string> = {};
    let tab: string | undefined;
    for (const [k, v] of new URLSearchParams(qs ?? "")) {
      if (k === "tab") tab = v;
      else params[k] = v;
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "e" && parts[1] !== undefined) {
      const iri = decodeURIComponent(parts.slice(1).join("/"));
      const id = this.model?.id(iri);
      if (id !== undefined) return { view: "entity", id, tab, params };
      // Try the curie form too (#/e/era:Track).
      const byCurie = this.model?.b.entities.find((e) => e.curie === iri);
      if (byCurie) return { view: "entity", id: byCurie.id, tab, params };
      return { view: "missing", query: iri, params };
    }
    if (parts[0] === "overview") return { view: "overview", params };
    return { view: "home", params };
  }

  readHash(): void {
    if (!this.model) return;
    this.setRoute(this.parseHash(location.hash));
  }

  private setRoute(r: Route): void {
    this._route = r;
    this.render();
    const iri = r.view === "entity" && r.id !== undefined && this.model ? this.model.entity(r.id).iri : null;
    this.opts.onNavigate?.(iri, r);
  }

  /** Public: open an IRI (or curie) if known. */
  goTo(iri: string, tab?: string): boolean {
    if (!this.model) return false;
    const id = this.model.id(iri) ?? this.model.b.entities.find((e) => e.curie === iri)?.id;
    if (id === undefined) return false;
    this.go(id, { tab });
    return true;
  }

  // ---- loading ------------------------------------------------------------
  async start(src?: string | null, focus?: string | null): Promise<void> {
    this.server = await serverStatus();
    if (src) {
      await this.openUrl(src, focus ?? undefined);
      return;
    }
    if (this.server?.loaded) {
      this.source = { kind: "server" };
      try {
        this.showProgress({ stage: "download", detail: "the server's model" });
        this.setBundle(await fetchBundleFromServer());
        if (focus) this.goTo(focus);
        else this.readHash();
        return;
      } catch (e) {
        this.showError(e as Error);
      }
    }
    this.showOpen();
  }

  async openUrl(url: string, focus?: string): Promise<void> {
    try {
      this.showProgress({ stage: "download", detail: url });
      const b = await loadUrl(url, (p) => this.showProgress(p), { relay: this.server?.relay });
      this.source = { kind: "url", url };
      if (this.opts.routing) {
        const u = new URL(location.href);
        if (u.searchParams.get("src") !== url) {
          u.searchParams.set("src", url);
          history.replaceState(history.state, "", u.toString());
        }
      }
      this.setBundle(b);
      if (focus) this.goTo(focus);
      else if (this.opts.routing && location.hash.length > 2) this.readHash();
      else this.goRoute({ view: "home" });
    } catch (e) {
      this.showError(e as Error, () => this.showOpen());
      this.opts.onError?.(e as Error);
    }
  }

  async openFiles(files: FileList | File[]): Promise<void> {
    try {
      if (this.opts.routing) {
        const u = new URL(location.href);
        u.searchParams.delete("src");
        history.replaceState(history.state, "", u.toString());
      }
      this.source = { kind: "files" };
      const list = Array.from(files).filter((f) => looksLikeRdf(f.name) || f.name.endsWith(".json"));
      if (list.length === 0) throw new Error("none of the files look like RDF (.ttl, .nt, .trig, .nq, .rdf, .owl, .jsonld) or a bundle (.json)");
      const named = await readFiles(list);
      // A single bundle file loads directly.
      if (named.length === 1 && named[0].name.endsWith(".json")) {
        const text = new TextDecoder().decode(named[0].bytes);
        const parsed = JSON.parse(text);
        if (parsed && parsed.entities) {
          this.setBundle(parsed as Bundle);
          this.goRoute({ view: "home" });
          return;
        }
      }
      this.showProgress({ stage: "parse", detail: named.map((f) => f.name).join(", ") });
      const total = named.reduce((a, f) => a + f.bytes.length, 0);
      const useServer = this.server && total > 60 * 1024 * 1024 && total <= (this.server.maxUploadBytes ?? 0);
      const b = useServer ? await parseOnServer(named, true) : await parseFiles(named, (p) => this.showProgress(p));
      this.setBundle(b);
      this.goRoute({ view: "home" });
    } catch (e) {
      this.showError(e as Error, () => this.showOpen());
      this.opts.onError?.(e as Error);
    }
  }

  setBundle(b: Bundle): void {
    this.model = new Model(b, this._prefs.lang || undefined);
    this._prefs.lang = this.model.lang;
    this.rebuildSidebar();
    this.renderTopbar();
    this.opts.onLoaded?.(b);
    if (this.opts.routing) this.readHash();
    else this.goRoute({ view: "home" });
  }

  private rebuildSidebar(): void {
    this.side?.el.remove();
    this.side = null;
    if (!this.model || this.opts.minimal) {
      this.bodyEl.classList.add("no-sidebar");
      return;
    }
    this.side = sidebar(this);
    this.bodyEl.insertBefore(this.side.el, this.mainEl);
    this.bodyEl.classList.remove("no-sidebar");
  }

  // ---- rendering ----------------------------------------------------------
  private inner(): HTMLElement {
    return this.mainEl.firstElementChild as HTMLElement;
  }

  private setMain(...children: Child[]): void {
    const inner = this.inner();
    inner.replaceChildren();
    for (const c of children) if (c) inner.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    this.mainEl.scrollTop = 0;
  }

  private render(): void {
    if (!this.model) return;
    const r = this._route;
    this.side?.select(r.view === "entity" ? r.id : undefined);
    this.side?.el.classList.remove("open");
    let page: HTMLElement;
    if (r.view === "entity" && r.id !== undefined) {
      const e = this.model.entity(r.id);
      switch (e.kind) {
        case "class":
          page = classPage(this, e);
          break;
        case "objectProperty":
        case "datatypeProperty":
        case "property":
          page = propertyPage(this, e);
          break;
        case "conceptScheme":
          page = schemePage(this, e);
          break;
        case "concept":
          page = conceptPage(this, e);
          break;
        case "nodeShape":
          page = shapePage(this, e);
          break;
        default:
          page = genericPage(this, e);
      }
      document.title = `${this.model.label(e)} · ${this.model.b.title ?? "ontology-explorer"}`;
    } else if (r.view === "overview") {
      page = overviewPage(this);
    } else if (r.view === "missing") {
      page = h("div", null, h("h1", null, "Not found"), h("p", null, "Nothing in the loaded model has the IRI ", h("code", null, r.query ?? ""), "."), button("Back to the start", () => this.goRoute({ view: "home" })));
    } else {
      page = homePage(this);
      if (this.opts.routing) document.title = this.model.b.title ?? "ontology-explorer";
    }
    this.setMain(page, this.opts.minimal ? null : this.footer());
  }

  private footer(): HTMLElement {
    return h("div", { class: "about-foot" }, "ontology-explorer · ", h("a", { href: "https://github.com/Matdata-eu/ontology-explorer", target: "_blank", rel: "noopener" }, "source"), " · ", h("a", { href: "https://github.com/Matdata-eu/ontology-explorer/issues", target: "_blank", rel: "noopener" }, "questions, bugs and feature requests"), " · ", h("a", { href: "#", onClick: (ev: Event) => {
      ev.preventDefault();
      this.about();
    } }, "about"));
  }

  private renderTopbar(): void {
    const t = this.topbar;
    t.replaceChildren();
    const m = this.model;
    // Only on narrow screens, where the sidebar slides in over the page.
    if (m) t.appendChild(button("", () => this.side?.el.classList.toggle("open"), { icon: "menu", cls: "ghost icon-only menu-btn", title: "Classes, properties and search" }));
    t.appendChild(h("a", { class: "title", href: this.hrefRoute({ view: "home" }), onClick: (ev: Event) => {
      ev.preventDefault();
      this.goRoute({ view: "home" });
    } }, matdataMark(), h("span", { class: "title-text" }, m?.b.title ?? "ontology-explorer"), m ? h("small", { class: "hide-mobile" }, `${m.b.stats.classes} classes`) : null));
    t.appendChild(h("span", { class: "spacer" }));
    if (m && m.b.languages.length > 1) {
      const sel = h("select", { class: "btn small select", title: "Language of labels", "aria-label": "Language of labels" }, m.b.languages.slice(0, 40).map((l) => h("option", { value: l }, l || "(no language)"))) as HTMLSelectElement;
      sel.value = m.lang;
      sel.addEventListener("change", () => this.setPrefs({ lang: sel.value }));
      t.appendChild(sel);
    }
    if (m) t.appendChild(button("Share", () => void this.share(), { icon: "share", cls: "small share-btn", title: "Copy a link to exactly this view" }));
    if (m) t.appendChild(button("Open…", () => this.showOpen(), { icon: "folder", cls: "small hide-mobile", title: "Load other files" }));
    const dark = this.isDark();
    t.appendChild(button("", () => this.setPrefs({ theme: this.isDark() ? "light" : "dark" }), { icon: dark ? "sun" : "moon", cls: "ghost icon-only", title: "Switch theme" }));
    t.appendChild(button("", () => openHelp(this.shellEl), { icon: "help", cls: "ghost icon-only", title: "Help" }));
    t.appendChild(button("", () => this.about(), { icon: "info", cls: "ghost icon-only about-btn", title: "About" }));
  }

  private isDark(): boolean {
    const t = this._prefs.theme;
    return t === "dark" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  }

  private applyTheme(): void {
    const host = this.root.getRootNode() instanceof ShadowRoot ? (this.root.getRootNode() as ShadowRoot).host : this.root;
    host.setAttribute("theme", this.isDark() ? "dark" : "light");
    this.renderTopbar();
  }

  private about(): void {
    const lic = this.server ? new URL("licenses", document.baseURI).href : "https://github.com/Matdata-eu/ontology-explorer/blob/main/THIRD_PARTY_NOTICES.md";
    openAbout(this.shellEl, { licensesUrl: lic, generator: this.model?.b.generator });
  }

  // ---- open / progress / errors --------------------------------------------
  showOpen(): void {
    const fileInput = h("input", { type: "file", multiple: true, accept: ".ttl,.turtle,.nt,.trig,.nq,.rdf,.owl,.xml,.jsonld,.json,.gz", hidden: true, onChange: (ev: Event) => {
      const files = (ev.target as HTMLInputElement).files;
      if (files?.length) this.openFiles(files);
    } }) as HTMLInputElement;
    const drop = h(
      "div",
      { class: "dropzone" },
      icon("folder", "drop-icon"),
      h("p", null, h("strong", null, "Drop files here"), " or ", h("button", { type: "button", class: "linkish", onClick: () => fileInput.click() }, "choose them")),
      h("p", { class: "muted small" }, "Turtle, RDF/XML, JSON-LD, N-Triples, TriG, N-Quads, or a bundle made with ", h("code", null, "ontology-explorer build"), "."),
      fileInput
    );
    drop.addEventListener("click", (ev) => {
      if (ev.target === drop) fileInput.click();
    });
    const urlInput = h("input", { class: "input", type: "url", placeholder: "https://example.org/ontology.ttl", "aria-label": "URL of an ontology or bundle", required: true }) as HTMLInputElement;
    const form = h("form", { class: "url-form", onSubmit: (ev: Event) => {
      ev.preventDefault();
      if (urlInput.value.trim()) this.openUrl(urlInput.value.trim());
    } }, urlInput, h("button", { type: "submit", class: "btn primary" }, "Open"));
    const examples = h("div", { class: "examples" });
    const page = h(
      "div",
      { class: "open-page" },
      this.model ? h("p", null, button("Back", () => this.render(), { icon: "back", cls: "small ghost" })) : null,
      h(
        "header",
        { class: "open-hero" },
        h("h1", null, this.model ? "Open another model" : "Explore an ontology"),
        h("p", { class: "lead" }, "Classes, properties, SKOS vocabularies and SHACL shapes as diagrams and readable pages. Give the ontology, its shapes and its vocabularies together; everything stays in your browser.")
      ),
      h(
        "div",
        { class: "open-grid" },
        h("section", { class: "card open-card" }, h("h2", null, "From your computer"), drop),
        h(
          "section",
          { class: "card open-card" },
          h("h2", null, "From the web"),
          h("p", { class: "muted" }, "The address of an RDF file or of a bundle."),
          form,
          this.server && !this.server.relay ? h("p", { class: "muted small" }, "The site must allow cross-origin requests; start the server with ", h("code", null, "--relay"), " to fetch any URL.") : h("p", { class: "muted small" }, "Add ", h("code", null, "?src="), " and the address to this page's link to open it straight away.")
        )
      ),
      examples
    );
    this.setMain(page, this.footer());
    this.loadExamples(examples);
  }

  private async loadExamples(host: HTMLElement): Promise<void> {
    // The standalone app looks for examples.json next to itself; an embedded component only when told where.
    const url = this.opts.examplesUrl ?? (this.opts.routing ? new URL("examples.json", document.baseURI).href : null);
    if (!url) return;
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) return;
      const list = (await r.json()) as { title: string; src: string; description?: string; focus?: string; publisher?: string }[];
      if (!Array.isArray(list) || list.length === 0) return;
      const base = new URL(url, document.baseURI);
      host.append(
        h("h2", null, "Examples"),
        h(
          "div",
          { class: "example-grid" },
          list.map((ex) =>
            h(
              "button",
              { type: "button", class: "example", onClick: () => {
                const src = new URL(ex.src, base).href;
                if (this.opts.routing) {
                  const u = new URL(location.href);
                  u.hash = ex.focus ? `#/e/${encodeURIComponent(ex.focus)}` : "";
                  history.replaceState(history.state, "", u.toString());
                }
                this.openUrl(src, ex.focus);
              } },
              h("strong", null, ex.title),
              ex.description ? h("span", { class: "muted" }, ex.description) : null,
              ex.publisher ? h("span", { class: "faint small" }, ex.publisher) : null
            )
          )
        )
      );
    } catch {
      /* no examples file */
    }
  }

  showProgress(p: LoadProgress): void {
    const label = p.stage === "download" ? "Downloading" : p.stage === "parse" ? "Reading RDF" : "Indexing";
    const det = p.loaded !== undefined ? `${(p.loaded / 1024 / 1024).toFixed(1)} MB${p.total ? ` of ${(p.total / 1024 / 1024).toFixed(1)} MB` : ""}` : p.detail ?? "";
    const pct = p.loaded !== undefined && p.total ? Math.min(100, (100 * p.loaded) / p.total) : undefined;
    const bar = h("i", { class: pct !== undefined ? "det" : "", style: pct !== undefined ? { width: pct + "%" } : {} });
    this.setMain(h("div", { class: "progress" }, h("div", null, h("strong", null, label), " ", h("span", { class: "muted" }, det)), h("div", { class: "bar" }, bar)));
  }

  showError(e: Error, back?: () => void): void {
    this.setMain(h("div", null, h("div", { class: "error" }, String(e.message || e)), back ? button("Try something else", back) : null));
  }

  private wireDrop(): void {
    const root = this.root;
    let over: HTMLElement | null = null;
    root.addEventListener("dragover", (ev) => {
      if (!ev.dataTransfer?.types.includes("Files")) return;
      ev.preventDefault();
      over = root.querySelector(".dropzone");
      over?.classList.add("over");
    });
    root.addEventListener("dragleave", () => over?.classList.remove("over"));
    root.addEventListener("drop", (ev) => {
      if (!ev.dataTransfer?.files.length) return;
      ev.preventDefault();
      over?.classList.remove("over");
      this.openFiles(ev.dataTransfer.files);
    });
  }
}

const PREFS_KEY = "ontology-explorer.prefs";
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
