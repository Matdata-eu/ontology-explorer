// Shared building blocks of the detail pages.
import type { AppCtx } from "../ctx";
import { button, copyText, h, icon, type Child } from "../dom";
import { KIND_LABEL, type Annotation, type Constraint, type Entity, type Id, type PropRow } from "../model";

export function kindBadge(e: Entity): HTMLElement {
  return h("span", { class: `badge k-${e.kind}` }, KIND_LABEL[e.kind]);
}

/** A clickable chip for an entity. */
export function chip(ctx: AppCtx, id: Id, opts: { showKind?: boolean; title?: string } = {}): HTMLElement {
  const e = ctx.m.entity(id);
  const a = h(
    "a",
    { class: `chip${e.deprecated ? " deprecated" : ""}${ctx.m.isExternal(id) ? " external" : ""}`, href: ctx.href(id), title: opts.title ?? `${e.curie}${ctx.m.comment(id) ? "\n" + ctx.m.comment(id) : ""}`, onClick: nav(ctx, id) },
    h("span", { class: `kind-dot k-${e.kind}` }),
    h("span", { class: "lbl" }, ctx.m.label(id)),
    opts.showKind ? h("span", { class: "faint" }, KIND_LABEL[e.kind].toLowerCase()) : null
  );
  return a;
}

/** A plain text link for an entity, for use inside sentences and tables. */
export function link(ctx: AppCtx, id: Id, text?: string): HTMLElement {
  const e = ctx.m.entity(id);
  return h("a", { href: ctx.href(id), class: e.deprecated ? "deprecated" : undefined, title: e.curie, onClick: nav(ctx, id) }, text ?? ctx.m.label(id));
}

export function nav(ctx: AppCtx, id: Id): EventListener {
  return ((ev: MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
    ev.preventDefault();
    ctx.go(id);
  }) as EventListener;
}

export function chips(ctx: AppCtx, ids: Id[], opts: { max?: number; showKind?: boolean; onMore?: () => void } = {}): HTMLElement {
  const max = opts.max ?? 40;
  const wrap = h("div", { class: "chips" });
  const render = (limit: number) => {
    wrap.replaceChildren();
    for (const id of ids.slice(0, limit)) wrap.appendChild(chip(ctx, id, { showKind: opts.showKind }));
    if (ids.length > limit) {
      wrap.appendChild(h("button", { class: "chip more", type: "button", onClick: () => render(ids.length) }, `+${ids.length - limit} more`));
    }
  };
  render(max);
  return wrap;
}

export function section(title: string, opts: { count?: number; tools?: Child[]; id?: string } = {}): HTMLElement {
  return h("div", { class: "section-title", id: opts.id }, h("span", null, title), opts.count !== undefined ? h("span", { class: "count" }, opts.count.toLocaleString()) : null, opts.tools?.length ? h("div", { class: "tools" }, ...opts.tools) : null);
}

export function iriLine(ctx: AppCtx, e: Entity): HTMLElement {
  return h(
    "div",
    { class: "iri-line" },
    h("span", { title: e.iri }, e.curie),
    button("", () => copyText(e.iri).then((ok) => ctx.toast(ok ? "IRI copied" : "Could not copy")), { icon: "copy", cls: "ghost icon-only", title: "Copy IRI" }),
    h("a", { class: "btn ghost icon-only", href: e.iri, target: "_blank", rel: "noopener", title: "Open the IRI in a new tab" }, icon("external")),
    e.sources?.length ? h("span", { class: "faint" }, "defined in ", e.sources.map((s) => h("span", { class: "badge src" }, ctx.m.b.sources[s]?.name ?? `#${s}`))) : h("span", { class: "faint" }, "referenced, not defined in the loaded files")
  );
}

export function pageHead(ctx: AppCtx, e: Entity, extraBadges: Child[] = [], opts: { abstract?: boolean } = {}): HTMLElement {
  const flags: Child[] = [kindBadge(e)];
  if (opts.abstract) flags.push(h("span", { class: "badge" }, "abstract"));
  if (e.deprecated) flags.push(h("span", { class: "badge warn" }, "deprecated"));
  if (e.status && e.status !== "stable" && e.status !== "deprecated") flags.push(h("span", { class: "badge" }, e.status));
  return h("div", null, h("div", { class: "page-head" }, h("h1", { class: `${opts.abstract ? "abstract" : ""}${e.deprecated ? " deprecated" : ""}` }, ctx.m.label(e)), ...flags, ...extraBadges), iriLine(ctx, e), ctx.m.comment(e) ? h("p", { class: "lead" }, ctx.m.comment(e)) : null, otherLabels(ctx, e));
}

function otherLabels(ctx: AppCtx, e: Entity): HTMLElement | null {
  if (!e.label) return null;
  const others = Object.entries(e.label).filter(([l]) => l !== ctx.m.lang && l !== "");
  if (others.length === 0) return null;
  return h("p", { class: "muted", style: { fontSize: "12.5px", marginTop: "-8px" } }, others.slice(0, 12).map(([l, v], i) => h("span", null, i ? " · " : "", h("span", { class: "faint" }, l + " "), v)), others.length > 12 ? h("span", { class: "faint" }, ` · +${others.length - 12} languages`) : null);
}

export function annotations(ctx: AppCtx, e: Entity): HTMLElement | null {
  const list = (e.annotations ?? []).filter((a) => !isNoise(a));
  if (list.length === 0) return null;
  const dl = h("dl", { class: "kv" });
  const grouped = new Map<Id, Annotation[]>();
  for (const a of list) {
    const g = grouped.get(a.p) ?? [];
    g.push(a);
    grouped.set(a.p, g);
  }
  for (const [p, as] of grouped) {
    dl.append(
      h("dt", { title: ctx.m.entity(p).iri }, ctx.m.entity(p).curie),
      h(
        "dd",
        null,
        as.map((a, i) => [i ? h("br") : null, a.r !== undefined ? link(ctx, a.r) : /^https?:\/\//.test(a.v) ? h("a", { href: a.v, target: "_blank", rel: "noopener" }, a.v) : a.v, a.lang ? h("span", { class: "faint" }, ` @${a.lang}`) : null])
      )
    );
  }
  return h("div", { class: "ann" }, section("Other annotations"), h("div", { class: "card" }, dl));
}

function isNoise(a: Annotation): boolean {
  return false && a.v === "";
}

/** One constraint as a readable line. */
export function constraintLine(ctx: AppCtx, c: Constraint): HTMLElement {
  const refs = (c.refs ?? []).slice(0, 10);
  if (c.kind === "sparql") {
    const [msg, ...rest] = c.text.split("\n");
    const query = rest.join("\n").trim();
    return h("li", null, h("span", { class: "ck" }, "sparql"), h("span", { class: "msg" }, msg || "SPARQL constraint"), query ? h("details", { class: "sparql" }, h("summary", { class: "faint" }, "query"), h("pre", null, query)) : null);
  }
  if (c.kind === "message") return h("li", null, h("span", { class: "msg faint" }, c.text));
  const words = PLAIN[c.kind];
  return h("li", null, h("span", { class: "ck" }, c.kind), words ? words + " " : "", refs.length && refs.length === c.text.split(", ").length && c.text.length < 200 ? refs.map((r, i) => [i ? ", " : "", link(ctx, r)]) : h("code", null, c.text));
}

const PLAIN: Record<string, string> = {
  pattern: "must match",
  minLength: "at least",
  maxLength: "at most",
  minInclusive: "≥",
  maxInclusive: "≤",
  minExclusive: ">",
  maxExclusive: "<",
  in: "one of",
  hasValue: "must include",
  languageIn: "language in",
  uniqueLang: "one value per language:",
  equals: "same values as",
  disjoint: "no value shared with",
  lessThan: "less than",
  lessThanOrEquals: "at most",
  node: "conforms to",
  class: "instance of",
  datatype: "typed",
  nodeKind: "node kind",
  or: "one of:",
  and: "all of:",
  xone: "exactly one of:",
  not: "not",
  closed: "closed:",
  qualifiedValueShape: "some values conform to",
  someValuesFrom: "some value from",
  allValuesFrom: "all values from",
  defaultValue: "default",
  flags: "regex flags",
};

/** The property table of a class or shape. */
export function propTable(ctx: AppCtx, rows: PropRow[], opts: { showInherited: boolean; showHidden: boolean; showSource?: boolean; forShape?: boolean }): HTMLElement {
  const m = ctx.m;
  const visible = rows.filter((r) => (opts.showInherited || r.inheritedFrom === undefined) && (opts.showHidden || !r.hidden));
  const hasGroups = visible.some((r) => r.group !== undefined);
  const table = h("table", { class: "ptable" });
  table.appendChild(
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "Property"), h("th", null, "Expected value"), h("th", null, "Card."), h("th", null, "Constraints"), opts.showSource !== false ? h("th", null, "From") : null)
    )
  );
  const tbody = h("tbody");
  let lastGroup: Id | undefined | null = null;
  let lastInherited: Id | undefined | null = null;
  for (const r of visible) {
    if (hasGroups && r.inheritedFrom === undefined && r.group !== lastGroup) {
      lastGroup = r.group;
      tbody.appendChild(h("tr", { class: "group-row" }, h("td", { colspan: 5 }, r.group !== undefined ? m.label(r.group) : "Other")));
    }
    if (r.inheritedFrom !== undefined && r.inheritedFrom !== lastInherited) {
      lastInherited = r.inheritedFrom;
      tbody.appendChild(h("tr", { class: "group-row" }, h("td", { colspan: 5 }, "Inherited from ", link(ctx, r.inheritedFrom))));
    }
    tbody.appendChild(propRowEl(ctx, r, opts));
  }
  table.appendChild(tbody);
  if (visible.length === 0) return h("p", { class: "muted" }, rows.length ? "All properties are hidden or inherited; use the toggles to show them." : "No properties are known for this class.");
  return table;
}

function propRowEl(ctx: AppCtx, r: PropRow, opts: { showSource?: boolean }): HTMLElement {
  const m = ctx.m;
  const name = m.rowName(r);
  const nameCell = h("td", { class: "pname" });
  if (r.property !== undefined && !r.inverse) {
    nameCell.appendChild(link(ctx, r.property, name));
    if (name.toLowerCase() !== r.path.toLowerCase() && name !== m.label(r.property)) nameCell.appendChild(h("span", { class: "path" }, r.path));
    else nameCell.appendChild(h("span", { class: "path" }, r.path));
  } else {
    nameCell.appendChild(h("span", null, name));
    nameCell.appendChild(h("span", { class: "path" }, (r.pathIds ?? []).length ? pathWithLinks(ctx, r) : r.path));
  }
  if (r.role) nameCell.appendChild(h("span", { class: "role", title: "dash:propertyRole" }, r.role));
  if (r.readOnly) nameCell.appendChild(h("span", { class: "role", title: "dash:readOnly" }, "read-only"));
  if (r.hidden) nameCell.appendChild(h("span", { class: "role", title: "dash:hidden" }, "hidden"));
  if (r.deactivated) nameCell.appendChild(h("span", { class: "role" }, "deactivated"));
  const desc = m.text(r.description);
  if (desc) nameCell.appendChild(h("div", { class: "desc" }, desc));

  const rng = h("td", { class: "rng" });
  const parts: Node[] = [];
  if (r.scheme !== undefined) parts.push(h("span", null, "value from ", link(ctx, r.scheme), h("span", { class: "faint" }, ` (${m.scheme(r.scheme)?.concepts?.length ?? 0})`)));
  for (const c of r.range ?? []) {
    if (r.scheme !== undefined && m.entity(c).iri === "http://www.w3.org/2004/02/skos/core#Concept") continue;
    parts.push(link(ctx, c));
  }
  if (r.datatype !== undefined) parts.push(h("span", { class: "mono", title: m.entity(r.datatype).iri }, m.entity(r.datatype).curie));
  for (const n of r.node ?? []) if (!(r.range ?? []).includes(n)) parts.push(h("span", null, "shape ", link(ctx, n)));
  if (parts.length === 0 && r.nodeKind) parts.push(h("span", { class: "muted" }, r.nodeKind === "IRI" ? "any resource (IRI)" : r.nodeKind === "Literal" ? "any literal" : r.nodeKind));
  if (parts.length === 0) parts.push(h("span", { class: "faint" }, r.literal ? "literal" : "any"));
  parts.forEach((p, i) => {
    if (i) rng.appendChild(document.createTextNode(" | "));
    rng.appendChild(p);
  });

  const mult = h("td", { class: "mult" }, multWords(r));
  const cons = (r.constraints ?? []).filter((c) => c.kind !== "message" || true);
  const consCell = h("td", null, cons.length ? h("ul", { class: "cons" }, cons.slice(0, 8).map((c) => constraintLine(ctx, c)), cons.length > 8 ? h("li", { class: "faint" }, `+${cons.length - 8} more`) : null) : null);
  const src = opts.showSource !== false ? h("td", null, (r.sources ?? []).map((s) => h("span", { class: `badge src`, title: SRC_TITLE[s] ?? s }, s)), (r.shapes ?? []).slice(0, 3).map((sid) => h("div", null, link(ctx, sid)))) : null;
  return h("tr", { class: `${r.inheritedFrom !== undefined ? "inherited" : ""}${r.hidden ? " hidden-row" : ""}` }, nameCell, rng, mult, consCell, src);
}

const SRC_TITLE: Record<string, string> = {
  ontology: "From rdfs:domain / rdfs:range in the ontology",
  restriction: "From an OWL restriction on the class",
  shape: "From a SHACL property shape",
};

function multWords(r: PropRow): string {
  const t = r.min === undefined && r.max === undefined ? "" : `${r.min ?? 0}..${r.max === undefined ? "*" : r.max}`;
  return t;
}

function pathWithLinks(ctx: AppCtx, r: PropRow): Child[] {
  // Replace each curie in the path text by a link, in order.
  const out: Child[] = [];
  let text = r.path;
  for (const id of r.pathIds ?? []) {
    const curie = ctx.m.entity(id).curie;
    const i = text.indexOf(curie);
    if (i < 0) continue;
    out.push(text.slice(0, i), link(ctx, id, curie));
    text = text.slice(i + curie.length);
  }
  out.push(text);
  return out;
}

export function emptyNote(text: string): HTMLElement {
  return h("p", { class: "muted" }, text);
}

const TOKEN = /("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*")|(<[^>\s]*>)|(#[^\n]*)|(@prefix\b|\ba\b(?= )|[A-Za-z][\w.-]*:(?:[\w-]+(?:[.\w-]*[\w-])?)?)/g;

/** The entity's triples as Turtle, with the names in it linked to their pages. */
export function rdfSection(ctx: AppCtx, e: Entity): HTMLElement | null {
  const body = ctx.m.b.rdf?.[e.id];
  if (!body) return null;
  // The bundle keeps the prefixes once; declare the ones this snippet uses.
  const used = new Set<string>();
  for (const t of body.matchAll(TOKEN)) if (t[4] && t[4].includes(":")) used.add(t[4].slice(0, t[4].indexOf(":")));
  const decl = [...used].sort().filter((p) => ctx.m.b.prefixes[p] !== undefined).map((p) => `@prefix ${p}: <${ctx.m.b.prefixes[p]}> .\n`);
  const text = decl.length ? `${decl.join("")}\n${body}` : body;
  const pre = h("pre", { class: "turtle" });
  let at = 0;
  for (const t of text.matchAll(TOKEN)) {
    if (t.index > at) pre.append(text.slice(at, t.index));
    at = t.index + t[0].length;
    const [tok, str, iriRef, comment] = t;
    if (str) pre.append(h("span", { class: "t-str" }, tok));
    else if (comment) pre.append(h("span", { class: "t-com" }, tok));
    else if (tok === "@prefix" || tok === "a") pre.append(h("span", { class: "t-kw" }, tok));
    else {
      const colon = tok.indexOf(":");
      const iri = iriRef ? tok.slice(1, -1) : (ctx.m.b.prefixes[tok.slice(0, colon)] ?? "") + tok.slice(colon + 1);
      const id = !iriRef && colon === tok.length - 1 ? undefined : ctx.m.id(iri);
      if (id !== undefined && id !== e.id) pre.append(h("a", { href: ctx.href(id), class: "t-iri", title: iri, onClick: nav(ctx, id) }, tok));
      else pre.append(h("span", { class: "t-iri", title: iri }, tok));
    }
  }
  pre.append(text.slice(at));
  const lines = text.split("\n").length - 1;
  const copy = button("Copy", () => copyText(text).then((ok) => ctx.toast(ok ? "Turtle copied" : "Could not copy")), { icon: "copy", cls: "small" });
  return h("div", { class: "rdf" }, section("RDF", { count: lines, tools: [h("span", { class: "faint small" }, "Turtle, as in the loaded files"), copy] }), pre);
}

/** Add the page's closing sections: other annotations, then the RDF. */
export function pageTail(ctx: AppCtx, e: Entity, page: HTMLElement): void {
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  const rdf = rdfSection(ctx, e);
  if (rdf) page.appendChild(rdf);
}
