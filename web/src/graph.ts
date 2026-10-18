// Builds the graph a diagram shows: which boxes, which arrows, what text.
import type { Id, Model, PropRow } from "./model";

export type NodeKind = "class" | "scheme" | "shape" | "more";

export interface AttrLine {
  text: string;
  type?: string;
  mult?: string;
  inherited?: boolean;
  deprecated?: boolean;
  group?: string;
  /** Property id, for navigation. */
  id?: Id;
}

export interface NodeSpec {
  key: string;
  id?: Id;
  kind: NodeKind;
  name: string;
  stereotype?: string;
  abstract?: boolean;
  deprecated?: boolean;
  external?: boolean;
  focus?: boolean;
  attrs: AttrLine[];
  /** Attributes not shown (collapsed). */
  hiddenAttrs: number;
  /** For "more" nodes: what they stand for. */
  moreOf?: { from: string; relation: string; ids: Id[] };
}

export type EdgeKind = "gen" | "assoc" | "comp" | "scheme" | "incoming";

export interface EdgeSpec {
  key: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  mult?: string;
  /** Property behind the edge, for navigation. */
  id?: Id;
}

export interface GraphSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  /** Nodes left out because of the neighbour cap. */
  omitted: number;
}

export interface NeighborhoodOptions {
  focus: Id;
  depth: 1 | 2;
  attributes: "all" | "focus" | "none";
  inherited: boolean;
  incoming: boolean;
  subclasses: boolean;
  schemes: boolean;
  hidden: boolean;
  maxNeighbors: number;
  maxAttrs: number;
  /** Extra classes to include with their neighbours (user expanded them). */
  expanded: Set<Id>;
  /** Attribute lists the user opened fully. */
  openAttrs: Set<Id>;
}

export const defaultNeighborhood = (focus: Id): NeighborhoodOptions => ({
  focus,
  depth: 1,
  attributes: "focus",
  inherited: false,
  incoming: true,
  subclasses: true,
  schemes: true,
  hidden: false,
  maxNeighbors: 28,
  maxAttrs: 14,
  expanded: new Set(),
  openAttrs: new Set(),
});

const SKOS_CONCEPT = "http://www.w3.org/2004/02/skos/core#Concept";

function attrLines(m: Model, cid: Id, opts: { inherited: boolean; hidden: boolean; cap: number; open: boolean }): { lines: AttrLine[]; hidden: number } {
  const ci = m.cls(cid);
  if (!ci?.props) return { lines: [], hidden: 0 };
  const all: AttrLine[] = [];
  for (const r of ci.props) {
    if (r.inheritedFrom !== undefined && !opts.inherited) continue;
    if (r.hidden && !opts.hidden) continue;
    if (!isAttribute(m, r)) continue;
    all.push({
      text: m.rowName(r),
      type: r.datatype !== undefined ? m.entity(r.datatype).curie.replace(/^xsd:/, "") : r.scheme !== undefined ? m.label(r.scheme) : r.nodeKind ?? undefined,
      mult: m.multiplicity(r),
      inherited: r.inheritedFrom !== undefined,
      deprecated: r.property !== undefined ? m.entity(r.property).deprecated : false,
      group: r.group !== undefined ? m.label(r.group) : undefined,
      id: r.property,
    });
  }
  if (opts.open || all.length <= opts.cap) return { lines: all, hidden: 0 };
  return { lines: all.slice(0, opts.cap), hidden: all.length - opts.cap };
}

/** A row drawn inside the box rather than as an arrow: literals, and value sets when schemes are not drawn as nodes. */
function isAttribute(m: Model, r: PropRow): boolean {
  if (r.literal) return true;
  const classes = (r.range ?? []).filter((c) => m.entity(c).iri !== SKOS_CONCEPT);
  return classes.length === 0 && r.scheme === undefined && (r.node?.length ?? 0) === 0;
}

function classNode(m: Model, id: Id, o: NeighborhoodOptions, isFocus: boolean): NodeSpec {
  const e = m.entity(id);
  const ci = m.cls(id);
  const showAttrs = o.attributes === "all" || (o.attributes === "focus" && (isFocus || o.expanded.has(id)));
  const { lines, hidden } = showAttrs ? attrLines(m, id, { inherited: o.inherited, hidden: o.hidden, cap: isFocus ? o.maxAttrs * 2 : o.maxAttrs, open: o.openAttrs.has(id) }) : { lines: [], hidden: 0 };
  const stereo: string[] = [];
  if (ci?.abstract) stereo.push("abstract");
  if (e.deprecated) stereo.push("deprecated");
  if (m.isExternal(id)) stereo.push("external");
  return {
    key: `c${id}`,
    id,
    kind: "class",
    name: m.label(id),
    stereotype: stereo.length ? `«${stereo.join(", ")}»` : undefined,
    abstract: ci?.abstract,
    deprecated: e.deprecated,
    external: m.isExternal(id),
    focus: isFocus,
    attrs: lines,
    hiddenAttrs: hidden,
  };
}

function schemeNode(m: Model, id: Id): NodeSpec {
  const si = m.scheme(id);
  return {
    key: `s${id}`,
    id,
    kind: "scheme",
    name: m.label(id),
    stereotype: `«concept scheme» ${si?.concepts?.length ?? 0} values`,
    attrs: [],
    hiddenAttrs: 0,
  };
}

/** The classes a row links to as arrows. */
function linkTargets(m: Model, r: PropRow): Id[] {
  return (r.range ?? []).filter((c) => m.entity(c).iri !== SKOS_CONCEPT || r.scheme === undefined);
}

export function buildNeighborhood(m: Model, o: NeighborhoodOptions): GraphSpec {
  const nodes = new Map<string, NodeSpec>();
  const edges = new Map<string, EdgeSpec>();
  let omitted = 0;
  let budget = o.maxNeighbors;

  const addClass = (id: Id, isFocus = false): boolean => {
    const key = `c${id}`;
    if (nodes.has(key)) return true;
    if (!isFocus && budget <= 0) {
      omitted++;
      return false;
    }
    if (!isFocus) budget--;
    nodes.set(key, classNode(m, id, o, isFocus));
    return true;
  };
  const addScheme = (id: Id): boolean => {
    const key = `s${id}`;
    if (nodes.has(key)) return true;
    if (budget <= 0) {
      omitted++;
      return false;
    }
    budget--;
    nodes.set(key, schemeNode(m, id));
    return true;
  };
  const addEdge = (e: EdgeSpec) => {
    if (!edges.has(e.key)) edges.set(e.key, e);
  };

  const expandFrom = (cid: Id, level: number, isFocus: boolean) => {
    const ci = m.cls(cid);
    if (!ci) return;
    // Generalisation: super classes.
    for (const sup of ci.superClasses ?? []) {
      if (addClass(sup)) addEdge({ key: `g${sup}-${cid}`, from: `c${sup}`, to: `c${cid}`, kind: "gen" });
    }
    // Sub classes (focus and expanded only).
    if (o.subclasses && (isFocus || o.expanded.has(cid))) {
      for (const sub of ci.subClasses ?? []) {
        if (addClass(sub)) addEdge({ key: `g${cid}-${sub}`, from: `c${cid}`, to: `c${sub}`, kind: "gen" });
      }
    }
    // Associations from this class.
    for (const r of ci.props ?? []) {
      if (r.inheritedFrom !== undefined && !(o.inherited && isFocus)) continue;
      if (r.hidden && !o.hidden) continue;
      const label = m.rowName(r);
      const mult = m.multiplicity(r);
      for (const t of linkTargets(m, r)) {
        if (addClass(t)) {
          addEdge({ key: `a${cid}-${r.path}-${t}`, from: `c${cid}`, to: `c${t}`, kind: r.composite ? "comp" : "assoc", label, mult, id: r.property });
        }
      }
      if (r.scheme !== undefined && o.schemes && (isFocus || o.expanded.has(cid) || level < o.depth)) {
        if (addScheme(r.scheme)) addEdge({ key: `s${cid}-${r.path}-${r.scheme}`, from: `c${cid}`, to: `s${r.scheme}`, kind: "scheme", label, mult, id: r.property });
      }
    }
    // Incoming associations.
    if (o.incoming && (isFocus || o.expanded.has(cid))) {
      for (const src of ci.referencedBy ?? []) {
        const sci = m.cls(src);
        if (!sci?.props) continue;
        for (const r of sci.props) {
          if (r.inheritedFrom !== undefined) continue;
          if (!linkTargets(m, r).includes(cid)) continue;
          if (addClass(src)) {
            addEdge({ key: `a${src}-${r.path}-${cid}`, from: `c${src}`, to: `c${cid}`, kind: r.composite ? "comp" : src === cid ? "assoc" : "incoming", label: m.rowName(r), mult: m.multiplicity(r), id: r.property });
          }
        }
      }
    }
  };

  addClass(o.focus, true);
  expandFrom(o.focus, 1, true);
  for (const x of o.expanded) {
    if (x !== o.focus && addClass(x)) expandFrom(x, 1, false);
  }
  if (o.depth >= 2) {
    const first = [...nodes.values()].filter((n) => n.kind === "class" && !n.focus && n.id !== undefined).map((n) => n.id as Id);
    for (const id of first) expandFrom(id, 2, false);
  }
  // Edges between nodes that are both present but were not walked (e.g. two
  // neighbours that are sub/super of each other) make the picture more honest.
  for (const n of [...nodes.values()]) {
    if (n.kind !== "class" || n.id === undefined) continue;
    const ci = m.cls(n.id);
    for (const sup of ci?.superClasses ?? []) {
      if (nodes.has(`c${sup}`)) addEdge({ key: `g${sup}-${n.id}`, from: `c${sup}`, to: `c${n.id}`, kind: "gen" });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], omitted };
}

/** One attribute line for a row drawn inside a box. */
function attrLine(m: Model, r: PropRow, inherited = false): AttrLine {
  return {
    text: m.rowName(r),
    type: r.datatype !== undefined ? m.entity(r.datatype).curie.replace(/^xsd:/, "") : r.scheme !== undefined ? m.label(r.scheme) : r.nodeKind ?? undefined,
    mult: m.multiplicity(r),
    inherited,
    deprecated: r.property !== undefined ? m.entity(r.property).deprecated : false,
    group: r.group !== undefined ? m.label(r.group) : undefined,
    id: r.property,
  };
}

function plainClassNode(m: Model, id: Id, attrs: AttrLine[] = []): NodeSpec {
  const e = m.entity(id);
  const stereo: string[] = [];
  if (m.cls(id)?.abstract) stereo.push("abstract");
  if (e.deprecated) stereo.push("deprecated");
  if (m.isExternal(id)) stereo.push("external");
  return { key: `c${id}`, id, kind: "class", name: m.label(id), stereotype: stereo.length ? `«${stereo.join(", ")}»` : undefined, abstract: m.cls(id)?.abstract, deprecated: e.deprecated, external: m.isExternal(id), attrs, hiddenAttrs: 0 };
}

function shapeNode(m: Model, id: Id, attrs: AttrLine[] = [], hidden = 0, focus = false): NodeSpec {
  const si = m.shape(id);
  return { key: `h${id}`, id, kind: "shape", name: m.label(id), stereotype: si?.deactivated ? "«node shape, deactivated»" : "«node shape»", deprecated: m.entity(id).deprecated, focus, attrs, hiddenAttrs: hidden };
}

/** A small graph builder with a cap on the number of boxes. */
function collector(max: number) {
  const nodes = new Map<string, NodeSpec>();
  const edges = new Map<string, EdgeSpec>();
  let omitted = 0;
  return {
    nodes,
    node(n: NodeSpec | (() => NodeSpec), key: string): boolean {
      if (nodes.has(key)) return true;
      if (nodes.size >= max) {
        omitted++;
        return false;
      }
      nodes.set(key, typeof n === "function" ? n() : n);
      return true;
    },
    edge(e: EdgeSpec) {
      if (nodes.has(e.from) && nodes.has(e.to) && !edges.has(e.key)) edges.set(e.key, e);
    },
    done: (): GraphSpec => ({ nodes: [...nodes.values()], edges: [...edges.values()], omitted }),
  };
}

/** A property between the classes that use it (or its domain) and what it points at. */
export function buildPropertyGraph(m: Model, pid: Id, max = 40): GraphSpec {
  const pi = m.prop(pid) ?? {};
  const g = collector(max);
  const name = m.label(pid);
  const holders = [...new Set([...(pi.usedByClasses ?? []), ...(pi.domain ?? [])])];
  const pointAt = (from: string, r: Pick<PropRow, "range" | "scheme" | "composite" | "path">, label: string, mult?: string) => {
    for (const t of linkTargets(m, r as PropRow)) {
      if (g.node(() => plainClassNode(m, t), `c${t}`)) g.edge({ key: `a${from}-${t}`, from, to: `c${t}`, kind: r.composite ? "comp" : "assoc", label, mult, id: pid });
    }
    if (r.scheme !== undefined && g.node(() => schemeNode(m, r.scheme!), `s${r.scheme}`)) g.edge({ key: `s${from}-${r.scheme}`, from, to: `s${r.scheme}`, kind: "scheme", label, mult, id: pid });
  };
  for (const c of holders) {
    const row = m.cls(c)?.props?.find((x) => x.property === pid && x.inheritedFrom === undefined && !x.inverse);
    const attrs = row && isAttribute(m, row) ? [attrLine(m, row)] : [];
    if (!g.node(() => plainClassNode(m, c, attrs), `c${c}`)) continue;
    // The class may already be there as a target; give it the attribute line.
    const n = g.nodes.get(`c${c}`)!;
    if (attrs.length && !n.attrs.length) n.attrs = attrs;
    if (row && !isAttribute(m, row)) pointAt(`c${c}`, row, m.rowName(row), m.multiplicity(row));
    else if (!row) pointAt(`c${c}`, { range: pi.range, scheme: pi.scheme, path: "" }, name);
  }
  // The shapes that constrain it, pointing at the same targets.
  for (const s of pi.usedByShapes ?? []) {
    const r = m.shape(s)?.properties?.find((x) => x.property === pid && !x.inverse);
    if (!r || m.shape(s)?.implicitTarget) continue;
    const attrs = isAttribute(m, r) ? [attrLine(m, r)] : [];
    if (!g.node(() => shapeNode(m, s, attrs), `h${s}`)) continue;
    if (!attrs.length) pointAt(`h${s}`, r, m.rowName(r), m.multiplicity(r));
  }
  return g.done();
}

/** A node shape with its property shapes, its targets and the shapes and classes it points at. */
export function buildShapeGraph(m: Model, sid: Id, opts: { open: boolean; hidden: boolean } = { open: false, hidden: false }, max = 40): GraphSpec {
  const si = m.shape(sid) ?? {};
  const g = collector(max);
  const rows = (si.properties ?? []).filter((r) => opts.hidden || !r.hidden);
  const lines = rows.filter((r) => isAttribute(m, r)).map((r) => attrLine(m, r));
  const cap = 28;
  const shown = opts.open || lines.length <= cap ? lines : lines.slice(0, cap);
  const me = `h${sid}`;
  g.node(shapeNode(m, sid, shown, lines.length - shown.length, true), me);
  for (const c of [...new Set([...(si.targetClass ?? []), ...(si.applicableTo ?? [])])]) {
    if (si.implicitTarget && c === sid) continue;
    if (g.node(() => plainClassNode(m, c), `c${c}`)) g.edge({ key: `t${sid}-${c}`, from: me, to: `c${c}`, kind: "incoming", label: "targets" });
  }
  for (const r of rows) {
    if (isAttribute(m, r)) continue;
    const label = m.rowName(r);
    const mult = m.multiplicity(r);
    for (const t of linkTargets(m, r)) {
      if (g.node(() => plainClassNode(m, t), `c${t}`)) g.edge({ key: `a${r.path}-${t}`, from: me, to: `c${t}`, kind: r.composite ? "comp" : "assoc", label, mult, id: r.property });
    }
    if (r.scheme !== undefined && g.node(() => schemeNode(m, r.scheme!), `s${r.scheme}`)) g.edge({ key: `s${r.path}-${r.scheme}`, from: me, to: `s${r.scheme}`, kind: "scheme", label, mult, id: r.property });
    for (const n of r.node ?? []) {
      if (n === sid) continue;
      if (m.shape(n) && g.node(() => shapeNode(m, n), `h${n}`)) g.edge({ key: `n${r.path}-${n}`, from: me, to: `h${n}`, kind: r.composite ? "comp" : "assoc", label, mult, id: r.property });
    }
  }
  for (const u of si.usedBy ?? []) {
    if (u !== sid && m.shape(u) && g.node(() => shapeNode(m, u), `h${u}`)) g.edge({ key: `u${u}`, from: `h${u}`, to: me, kind: "incoming" });
  }
  return g.done();
}

export interface OverviewOptions {
  associations: boolean;
  externals: boolean;
  namespace?: string;
  maxNodes: number;
}

export function buildOverview(m: Model, o: OverviewOptions): GraphSpec {
  const nodes = new Map<string, NodeSpec>();
  const edges = new Map<string, EdgeSpec>();
  let omitted = 0;
  const ids: Id[] = [];
  for (const [k, ci] of Object.entries(m.b.classes)) {
    const id = Number(k);
    const e = m.entity(id);
    if (!o.externals && m.isExternal(id)) continue;
    if (o.namespace && !e.iri.startsWith(o.namespace)) continue;
    void ci;
    ids.push(id);
  }
  // Prefer connected, defined, non-deprecated classes when capping.
  ids.sort((a, b) => score(m, b) - score(m, a));
  const kept = ids.slice(0, o.maxNodes);
  omitted = ids.length - kept.length;
  const keptSet = new Set(kept);
  for (const id of kept) {
    const e = m.entity(id);
    const ci = m.cls(id);
    nodes.set(`c${id}`, {
      key: `c${id}`,
      id,
      kind: "class",
      name: m.label(id),
      abstract: ci?.abstract,
      deprecated: e.deprecated,
      external: m.isExternal(id),
      attrs: [],
      hiddenAttrs: 0,
    });
  }
  for (const id of kept) {
    const ci = m.cls(id);
    for (const sup of ci?.superClasses ?? []) {
      if (keptSet.has(sup)) edges.set(`g${sup}-${id}`, { key: `g${sup}-${id}`, from: `c${sup}`, to: `c${id}`, kind: "gen" });
    }
    if (o.associations) {
      const seen = new Set<Id>();
      for (const r of ci?.props ?? []) {
        if (r.inheritedFrom !== undefined) continue;
        for (const t of linkTargets(m, r)) {
          if (!keptSet.has(t) || t === id || seen.has(t)) continue;
          seen.add(t);
          edges.set(`a${id}-${t}`, { key: `a${id}-${t}`, from: `c${id}`, to: `c${t}`, kind: r.composite ? "comp" : "assoc", label: m.rowName(r), id: r.property });
        }
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], omitted };
}

function score(m: Model, id: Id): number {
  const ci = m.cls(id);
  const e = m.entity(id);
  let s = (ci?.ownProps ?? 0) + (ci?.subClasses?.length ?? 0) * 3 + (ci?.referencedBy?.length ?? 0) * 2 + (ci?.superClasses?.length ?? 0);
  if (m.isExternal(id)) s -= 50;
  if (e.deprecated) s -= 20;
  return s;
}

/** Namespaces of the defined classes, most used first. */
export function classNamespaces(m: Model): { ns: string; prefix: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of Object.keys(m.b.classes)) {
    const e = m.entity(Number(k));
    if (m.isExternal(e.id)) continue;
    const i = Math.max(e.iri.lastIndexOf("#"), e.iri.lastIndexOf("/"));
    const ns = e.iri.slice(0, i + 1);
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  const byNs = new Map(Object.entries(m.b.prefixes).map(([p, ns]) => [ns, p]));
  return [...counts.entries()].map(([ns, count]) => ({ ns, prefix: byNs.get(ns) ?? ns, count })).sort((a, b) => b.count - a.count);
}

// ---- text exports ---------------------------------------------------------

function safeId(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, "_");
}

export function toPlantUml(g: GraphSpec): string {
  const out: string[] = ["@startuml", "hide empty members", "skinparam classAttributeIconSize 0"];
  for (const n of g.nodes) {
    if (n.kind === "more") continue;
    const id = safeId(n.key);
    const kw = n.kind === "scheme" ? "enum" : n.abstract ? "abstract class" : "class";
    const stereo = n.kind === "scheme" ? " <<concept scheme>>" : n.deprecated ? " <<deprecated>>" : "";
    if (n.attrs.length === 0) {
      out.push(`${kw} "${n.name}" as ${id}${stereo}`);
    } else {
      out.push(`${kw} "${n.name}" as ${id}${stereo} {`);
      let group: string | undefined;
      for (const a of n.attrs) {
        if (a.group !== group) {
          group = a.group;
          if (group) out.push(`  .. ${group} ..`);
        }
        out.push(`  ${a.text}${a.type ? " : " + a.type : ""}${a.mult ? " " + a.mult : ""}`);
      }
      if (n.hiddenAttrs) out.push(`  .. ${n.hiddenAttrs} more ..`);
      out.push("}");
    }
  }
  for (const e of g.edges) {
    const a = safeId(e.from);
    const b = safeId(e.to);
    switch (e.kind) {
      case "gen":
        out.push(`${a} <|-- ${b}`);
        break;
      case "comp":
        out.push(`${a} *--> ${e.mult ? `"${e.mult}" ` : ""}${b}${e.label ? " : " + e.label : ""}`);
        break;
      case "scheme":
        out.push(`${a} ..> ${e.mult ? `"${e.mult}" ` : ""}${b}${e.label ? " : " + e.label : ""}`);
        break;
      default:
        out.push(`${a} --> ${e.mult ? `"${e.mult}" ` : ""}${b}${e.label ? " : " + e.label : ""}`);
    }
  }
  out.push("@enduml");
  return out.join("\n");
}

export function toMermaid(g: GraphSpec): string {
  const out: string[] = ["classDiagram"];
  const q = (s: string) => s.replace(/[`"]/g, "'");
  for (const n of g.nodes) {
    if (n.kind === "more") continue;
    const id = safeId(n.key);
    out.push(`  class ${id}["${q(n.name)}"]`);
    if (n.kind === "scheme") out.push(`  <<concept scheme>> ${id}`);
    else if (n.abstract) out.push(`  <<abstract>> ${id}`);
    else if (n.deprecated) out.push(`  <<deprecated>> ${id}`);
    for (const a of n.attrs) {
      const type = a.type ? a.type.replace(/[^A-Za-z0-9_:]/g, "_") : "";
      out.push(`  ${id} : ${type ? type + " " : ""}${q(a.text).replace(/[^A-Za-z0-9_ ]/g, "_")}${a.mult ? " " + a.mult.replace(/\.\./g, "_") : ""}`);
    }
    if (n.hiddenAttrs) out.push(`  ${id} : ... ${n.hiddenAttrs} more`);
  }
  for (const e of g.edges) {
    const a = safeId(e.from);
    const b = safeId(e.to);
    const lbl = e.label ? ` : ${q(e.label)}${e.mult ? " " + e.mult : ""}` : "";
    switch (e.kind) {
      case "gen":
        out.push(`  ${a} <|-- ${b}`);
        break;
      case "comp":
        out.push(`  ${a} *-- ${b}${lbl}`);
        break;
      case "scheme":
        out.push(`  ${a} ..> ${b}${lbl}`);
        break;
      default:
        out.push(`  ${a} --> ${b}${lbl}`);
    }
  }
  return out.join("\n");
}
