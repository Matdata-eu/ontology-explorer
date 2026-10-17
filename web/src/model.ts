// Types mirroring crates/core/src/bundle.rs, plus lookups the views share.

export type Id = number;
export type LangMap = Record<string, string>;

export type Kind =
  | "ontology"
  | "class"
  | "objectProperty"
  | "datatypeProperty"
  | "annotationProperty"
  | "property"
  | "datatype"
  | "concept"
  | "conceptScheme"
  | "collection"
  | "nodeShape"
  | "propertyShape"
  | "propertyGroup"
  | "individual";

export interface Annotation {
  p: Id;
  v: string;
  r?: Id;
  lang?: string;
}

export interface Entity {
  id: Id;
  iri: string;
  curie: string;
  kind: Kind;
  label?: LangMap;
  comment?: LangMap;
  deprecated?: boolean;
  status?: string;
  sources?: number[];
  annotations?: Annotation[];
}

export interface Constraint {
  kind: string;
  text: string;
  refs?: Id[];
}

export interface PropRow {
  property?: Id;
  path: string;
  pathIds?: Id[];
  inverse?: boolean;
  name?: LangMap;
  description?: LangMap;
  range?: Id[];
  datatype?: Id;
  nodeKind?: string;
  scheme?: Id;
  node?: Id[];
  min?: number;
  max?: number;
  group?: Id;
  order?: number;
  role?: string;
  composite?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  viewer?: string;
  sources?: string[];
  shapes?: Id[];
  inheritedFrom?: Id;
  constraints?: Constraint[];
  literal?: boolean;
  severity?: string;
  deactivated?: boolean;
}

export interface ClassInfo {
  superClasses?: Id[];
  subClasses?: Id[];
  ancestors?: Id[];
  equivalent?: Id[];
  disjoint?: Id[];
  unionOf?: Id[];
  abstract?: boolean;
  shapes?: Id[];
  props?: PropRow[];
  inRangeOf?: Id[];
  referencedBy?: Id[];
  instances?: Id[];
  ownProps?: number;
}

export interface PropertyInfo {
  domain?: Id[];
  range?: Id[];
  superProperties?: Id[];
  subProperties?: Id[];
  inverseOf?: Id[];
  equivalent?: Id[];
  characteristics?: string[];
  scheme?: Id;
  usedByClasses?: Id[];
  usedByShapes?: Id[];
}

export interface SchemeInfo {
  topConcepts?: Id[];
  concepts?: Id[];
  usedBy?: Id[];
}

export interface ConceptInfo {
  schemes?: Id[];
  broader?: Id[];
  narrower?: Id[];
  related?: Id[];
  topConceptOf?: Id[];
  notation?: string[];
  altLabels?: Record<string, string[]>;
  mappings?: [string, string][];
  collections?: Id[];
}

export interface CollectionInfo {
  members?: Id[];
  ordered?: boolean;
}

export interface ShapeInfo {
  targetClass?: Id[];
  implicitTarget?: boolean;
  targetNode?: string[];
  targetSubjectsOf?: Id[];
  targetObjectsOf?: Id[];
  applicableTo?: Id[];
  closed?: boolean;
  deactivated?: boolean;
  severity?: string;
  properties?: PropRow[];
  constraints?: Constraint[];
  usedBy?: Id[];
  messages?: string[];
}

export interface GroupInfo {
  order?: number;
}

export interface IndividualInfo {
  types?: Id[];
}

export interface OntologyInfo {
  imports?: string[];
  version?: string;
  versionIri?: string;
}

export interface Stats {
  triples: number;
  classes: number;
  objectProperties: number;
  datatypeProperties: number;
  annotationProperties: number;
  otherProperties: number;
  conceptSchemes: number;
  concepts: number;
  nodeShapes: number;
  propertyShapes: number;
  individuals: number;
  datatypes: number;
  usesDash: boolean;
  usesShacl: boolean;
  usesSkos: boolean;
}

export interface Bundle {
  format: number;
  generator: string;
  title?: string;
  sources: { name: string; triples: number }[];
  prefixes: Record<string, string>;
  languages: string[];
  stats: Stats;
  entities: Entity[];
  classes: Record<string, ClassInfo>;
  properties: Record<string, PropertyInfo>;
  schemes: Record<string, SchemeInfo>;
  concepts: Record<string, ConceptInfo>;
  collections: Record<string, CollectionInfo>;
  shapes: Record<string, ShapeInfo>;
  groups: Record<string, GroupInfo>;
  individuals: Record<string, IndividualInfo>;
  ontologies: Record<string, OntologyInfo>;
  rootClasses: Id[];
  suggested?: Id;
}

export const KIND_LABEL: Record<Kind, string> = {
  ontology: "Ontology",
  class: "Class",
  objectProperty: "Object property",
  datatypeProperty: "Datatype property",
  annotationProperty: "Annotation property",
  property: "Property",
  datatype: "Datatype",
  concept: "Concept",
  conceptScheme: "Concept scheme",
  collection: "Collection",
  nodeShape: "Node shape",
  propertyShape: "Property shape",
  propertyGroup: "Property group",
  individual: "Individual",
};

export const KIND_PLURAL: Record<Kind, string> = {
  ontology: "Ontologies",
  class: "Classes",
  objectProperty: "Object properties",
  datatypeProperty: "Datatype properties",
  annotationProperty: "Annotation properties",
  property: "Properties",
  datatype: "Datatypes",
  concept: "Concepts",
  conceptScheme: "Concept schemes",
  collection: "Collections",
  nodeShape: "Node shapes",
  propertyShape: "Property shapes",
  propertyGroup: "Property groups",
  individual: "Individuals",
};

export function isProperty(k: Kind): boolean {
  return k === "objectProperty" || k === "datatypeProperty" || k === "annotationProperty" || k === "property";
}

/** The bundle with the indexes the views need. */
export class Model {
  readonly b: Bundle;
  readonly byIri = new Map<string, Id>();
  lang: string;
  /** Ids of entities that the inputs define (as opposed to merely mention). */
  readonly defined: Set<Id>;
  private searchIndex: SearchEntry[] | null = null;

  constructor(b: Bundle, lang?: string) {
    this.b = b;
    for (const e of b.entities) this.byIri.set(e.iri, e.id);
    this.lang = lang && b.languages.includes(lang) ? lang : b.languages[0] ?? "en";
    this.defined = new Set(b.entities.filter((e) => e.sources && e.sources.length > 0).map((e) => e.id));
  }

  entity(id: Id): Entity {
    return this.b.entities[id];
  }

  id(iri: string): Id | undefined {
    return this.byIri.get(iri);
  }

  /** Human name in the current language, falling back to other languages, then the local name. */
  label(id: Id | Entity): string {
    const e = typeof id === "number" ? this.b.entities[id] : id;
    return pickLang(e.label, this.lang) ?? localName(e.iri);
  }

  comment(id: Id | Entity): string | undefined {
    const e = typeof id === "number" ? this.b.entities[id] : id;
    return pickLang(e.comment, this.lang);
  }

  text(m: LangMap | undefined): string | undefined {
    return pickLang(m, this.lang);
  }

  cls(id: Id): ClassInfo | undefined {
    return this.b.classes[id];
  }
  prop(id: Id): PropertyInfo | undefined {
    return this.b.properties[id];
  }
  scheme(id: Id): SchemeInfo | undefined {
    return this.b.schemes[id];
  }
  concept(id: Id): ConceptInfo | undefined {
    return this.b.concepts[id];
  }
  shape(id: Id): ShapeInfo | undefined {
    return this.b.shapes[id];
  }

  isExternal(id: Id): boolean {
    return !this.defined.has(id);
  }

  /** Readable name of a property row: sh:name, then the property's label, then the path. */
  rowName(r: PropRow): string {
    const n = pickLang(r.name, this.lang);
    if (n) return n;
    if (r.property !== undefined && !r.inverse) return this.label(r.property);
    return r.path;
  }

  /** The classes/datatype/scheme a row points at, as text. */
  rowRange(r: PropRow): string {
    const parts: string[] = [];
    if (r.scheme !== undefined) parts.push(this.label(r.scheme));
    for (const c of r.range ?? []) {
      if (r.scheme !== undefined && this.entity(c).iri === "http://www.w3.org/2004/02/skos/core#Concept") continue;
      parts.push(this.label(c));
    }
    if (r.datatype !== undefined) parts.push(this.entity(r.datatype).curie.replace(/^xsd:/, ""));
    if (parts.length === 0 && r.nodeKind) parts.push(r.nodeKind);
    return parts.join(" | ");
  }

  /** `[1..*]` style multiplicity text, or "" when nothing is known. */
  multiplicity(r: PropRow): string {
    if (r.min === undefined && r.max === undefined) return "";
    const lo = r.min ?? 0;
    const hi = r.max === undefined ? "*" : String(r.max);
    if (lo === r.max) return `[${lo}]`;
    return `[${lo}..${hi}]`;
  }

  /** Entities matching a query, best first. */
  search(query: string, opts: { kinds?: Set<Kind>; limit?: number; scheme?: Id } = {}): Id[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (!this.searchIndex) this.searchIndex = buildSearchIndex(this);
    const limit = opts.limit ?? 50;
    const terms = q.split(/\s+/).filter(Boolean);
    const scored: { id: Id; score: number }[] = [];
    const inScheme = opts.scheme !== undefined ? new Set(this.scheme(opts.scheme)?.concepts ?? []) : null;
    for (const s of this.searchIndex) {
      const e = this.b.entities[s.id];
      if (opts.kinds && !opts.kinds.has(e.kind)) continue;
      if (inScheme && !inScheme.has(s.id)) continue;
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (s.label === t) score += 100;
        else if (s.label.startsWith(t)) score += 60;
        else if (s.local === t) score += 70;
        else if (s.local.startsWith(t)) score += 45;
        else if (s.words.some((w) => w.startsWith(t))) score += 30;
        else if (s.label.includes(t)) score += 20;
        else if (s.curie.includes(t)) score += 15;
        else if (s.alt.some((a) => a.includes(t))) score += 10;
        else if (s.comment.includes(t)) score += 4;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (e.deprecated) score -= 15;
      if (this.isExternal(s.id)) score -= 10;
      score += KIND_BOOST[e.kind] ?? 0;
      scored.push({ id: s.id, score: score - Math.min(s.label.length, 40) / 20 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => x.id);
  }
}

/** Search favours the things people look for first: classes, then properties and vocabularies. */
const KIND_BOOST: Partial<Record<Kind, number>> = {
  class: 10,
  objectProperty: 5,
  datatypeProperty: 5,
  property: 3,
  conceptScheme: 5,
  concept: -4,
  nodeShape: -6,
  propertyShape: -12,
  individual: -6,
  annotationProperty: -8,
};

interface SearchEntry {
  id: Id;
  label: string;
  local: string;
  curie: string;
  words: string[];
  alt: string[];
  comment: string;
}

function buildSearchIndex(m: Model): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const e of m.b.entities) {
    if (e.kind === "annotationProperty" && m.isExternal(e.id)) continue;
    const label = m.label(e).toLowerCase();
    const alt: string[] = [];
    if (e.label) for (const [l, v] of Object.entries(e.label)) if (l !== m.lang) alt.push(v.toLowerCase());
    const ci = e.kind === "concept" ? m.concept(e.id) : undefined;
    if (ci?.notation) alt.push(...ci.notation.map((n) => n.toLowerCase()));
    if (ci?.altLabels) for (const vs of Object.values(ci.altLabels)) alt.push(...vs.map((v) => v.toLowerCase()));
    out.push({
      id: e.id,
      label,
      local: localName(e.iri).toLowerCase(),
      curie: e.curie.toLowerCase(),
      words: label.split(/[\s\-_/(),.]+/).filter(Boolean),
      alt,
      comment: (m.comment(e) ?? "").toLowerCase().slice(0, 300),
    });
  }
  return out;
}

export function pickLang(m: LangMap | undefined, lang: string): string | undefined {
  if (!m) return undefined;
  if (m[lang] !== undefined) return m[lang];
  if (m["en"] !== undefined) return m["en"];
  if (m[""] !== undefined) return m[""];
  const first = Object.values(m)[0];
  return first;
}

export function localName(iri: string): string {
  const i = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  const local = i >= 0 ? iri.slice(i + 1) : iri;
  if (local) return local;
  // Namespace IRIs ("http://x/ns/") end in a separator: use the last segment.
  const trimmed = iri.replace(/[#/]+$/, "");
  const j = Math.max(trimmed.lastIndexOf("#"), trimmed.lastIndexOf("/"));
  return j >= 0 ? trimmed.slice(j + 1) : trimmed;
}

/** Split a camelCase or snake_case local name into words, for display when there is no label. */
export function humanize(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
