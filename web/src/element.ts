// <ontology-explorer>: the viewer as a web component.
import { App } from "./app";
import type { Bundle } from "./model";
import css from "./styles.css?inline";

let sheet: CSSStyleSheet | null = null;
function styles(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  return sheet;
}

/**
 * Attributes:
 *  - `src`      URL of a bundle.json or an RDF file
 *  - `focus`    IRI (or curie) to open first
 *  - `lang`     label language
 *  - `theme`    light | dark | auto
 *  - `routing`  present: use location.hash for navigation (the standalone app)
 *  - `minimal`  present: no sidebar or top bar, only the page (for embedding one entity)
 *  - `examples` URL of an examples.json list for the open screen
 * Events: `oe-navigate` {iri, route}, `oe-loaded` {bundle}, `oe-error` {error}
 */
export class OntologyExplorerElement extends HTMLElement {
  static observedAttributes = ["src", "focus", "lang", "theme"];
  private app: App | null = null;
  private started = false;

  connectedCallback(): void {
    if (this.app) return;
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [styles()];
    const root = document.createElement("div");
    root.style.height = "100%";
    shadow.appendChild(root);
    if (!this.style.height && !this.hasAttribute("routing")) this.style.minHeight = "480px";
    this.app = new App(root, {
      routing: this.hasAttribute("routing"),
      embed: !this.hasAttribute("routing"),
      minimal: this.hasAttribute("minimal"),
      lang: this.getAttribute("lang") ?? undefined,
      theme: (this.getAttribute("theme") as "light" | "dark" | "auto" | null) ?? undefined,
      examplesUrl: this.getAttribute("examples") ?? undefined,
      onNavigate: (iri, route) => this.dispatchEvent(new CustomEvent("oe-navigate", { detail: { iri, route }, bubbles: true, composed: true })),
      onLoaded: (bundle) => this.dispatchEvent(new CustomEvent("oe-loaded", { detail: { bundle }, bubbles: true, composed: true })),
      onError: (error) => this.dispatchEvent(new CustomEvent("oe-error", { detail: { error }, bubbles: true, composed: true })),
    });
    this.started = true;
    const src = this.getAttribute("src") ?? (this.hasAttribute("routing") ? new URLSearchParams(location.search).get("src") : null);
    const focus = this.getAttribute("focus") ?? (this.hasAttribute("routing") ? new URLSearchParams(location.search).get("focus") : null);
    void this.app.start(src, focus);
  }

  disconnectedCallback(): void {
    this.app?.destroy();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (!this.started || !this.app || old === value) return;
    if (name === "src" && value) void this.app.openUrl(value, this.getAttribute("focus") ?? undefined);
    else if (name === "focus" && value) this.app.goTo(value);
    else if (name === "lang" && value) this.app.setPrefs({ lang: value });
    else if (name === "theme" && value) this.app.setPrefs({ theme: value as "light" | "dark" | "auto" });
  }

  /** Load a bundle object, a URL, or RDF files. */
  async load(input: string | Bundle | FileList | File[]): Promise<void> {
    if (!this.app) throw new Error("element not connected");
    if (typeof input === "string") await this.app.openUrl(input);
    else if (input instanceof FileList || Array.isArray(input)) await this.app.openFiles(input);
    else this.app.setBundle(input);
  }

  /** Open an entity by IRI or curie; returns false when it is not in the model. */
  goTo(iri: string, tab?: "diagram" | "table"): boolean {
    return this.app?.goTo(iri, tab) ?? false;
  }

  get bundle(): Bundle | null {
    return this.app?.bundle ?? null;
  }
}

export function define(tag = "ontology-explorer"): void {
  if (!customElements.get(tag)) customElements.define(tag, OntologyExplorerElement);
}
