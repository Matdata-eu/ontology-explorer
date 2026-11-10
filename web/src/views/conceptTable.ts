// The concept table of a scheme page: one row per concept with its IRI,
// notation, preferred label and definition. Rows with narrower concepts expand
// into a tree; every column can be sorted and filtered.
import type { AppCtx } from "../ctx";
import { h, icon } from "../dom";
import type { Id, SchemeInfo } from "../model";
import { link } from "./common";

type Col = "iri" | "notation" | "label" | "definition";

const COLS: { key: Col; title: string }[] = [
  { key: "iri", title: "IRI" },
  { key: "notation", title: "Notation" },
  { key: "label", title: "Label" },
  { key: "definition", title: "Definition" },
];

/** How many sibling rows are rendered before a "show more" row. */
const PAGE = 300;

interface Row {
  id: Id;
  iri: string;
  curie: string;
  notation: string;
  label: string;
  definition: string;
  deprecated: boolean;
  children: Id[];
}

export function conceptTable(ctx: AppCtx, si: SchemeInfo): HTMLElement & { tools: HTMLElement[] } {
  const m = ctx.m;
  const inScheme = new Set<Id>(si.concepts ?? []);
  const rows = new Map<Id, Row>();
  const row = (id: Id): Row => {
    let r = rows.get(id);
    if (r) return r;
    const e = m.entity(id);
    const ci = m.concept(id);
    r = {
      id,
      iri: e.iri,
      curie: e.curie,
      notation: (ci?.notation ?? []).join(", "),
      label: m.label(id),
      definition: m.comment(id) ?? "",
      deprecated: e.deprecated === true,
      // Narrower concepts from another scheme hang under the row too (ERA
      // chains schemes this way); they get a badge saying where they live.
      children: (ci?.narrower ?? []).filter((c) => c !== id),
    };
    rows.set(id, r);
    return r;
  };

  // Roots: the top concepts, then concepts of the scheme that no other concept
  // of the scheme reaches (schemes without skos:hasTopConcept, or orphans).
  const reached = new Set<Id>();
  const stack: Id[] = [...(si.topConcepts ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const c of row(id).children) stack.push(c);
  }
  const roots: Id[] = [...(si.topConcepts ?? [])];
  const rootSet = new Set(roots);
  for (const id of si.concepts ?? []) {
    if (reached.has(id) || rootSet.has(id)) continue;
    const broaderHere = (m.concept(id)?.broader ?? []).some((b) => inScheme.has(b));
    if (!broaderHere) {
      roots.push(id);
      rootSet.add(id);
    }
  }
  // Concepts only reachable through a cycle: list them as roots too so they are not lost.
  for (const id of si.concepts ?? []) {
    if (!reached.has(id) && !rootSet.has(id)) {
      let seen = false;
      const st = [id];
      const local = new Set<Id>();
      while (st.length && !seen) {
        const x = st.pop()!;
        if (local.has(x)) continue;
        local.add(x);
        if (rootSet.has(x)) seen = true;
        for (const c of row(x).children) st.push(c);
      }
      if (!seen) {
        roots.push(id);
        rootSet.add(id);
      }
      for (const x of local) reached.add(x);
    }
  }
  // Every concept the table can show: the scheme's own, plus narrower ones reached from them.
  const all: Id[] = [];
  {
    const seen = new Set<Id>();
    const st = [...roots];
    while (st.length) {
      const id = st.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(id);
      for (const c of row(id).children) st.push(c);
    }
    for (const id of si.concepts ?? []) if (!seen.has(id)) all.push(id);
  }
  const total = all.length;
  const foreignScheme = (id: Id): Id | undefined => (inScheme.has(id) ? undefined : (m.concept(id)?.schemes ?? [])[0]);

  // ----- state --------------------------------------------------------------
  let sortCol: Col | null = null;
  let sortDir: 1 | -1 = 1;
  const filters: Record<Col, string> = { iri: "", notation: "", label: "", definition: "" };
  const expanded = new Set<Id>();
  let allOpen = false;
  // Small top levels start open, as the tree did; big ones stay folded.
  for (const r of roots) if (row(r).children.length && row(r).children.length <= 12 && roots.length <= 50) expanded.add(r);
  /** Extra rows shown past the page limit, per parent (or -1 for the roots). */
  const shown = new Map<Id, number>();

  const value = (r: Row, c: Col): string => (c === "iri" ? r.curie : c === "notation" ? r.notation : c === "label" ? r.label : r.definition);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const cmp = (a: Id, b: Id): number => {
    if (!sortCol) return 0;
    const ra = row(a);
    const rb = row(b);
    const va = value(ra, sortCol);
    const vb = value(rb, sortCol);
    // Empty values go last whichever way the column is sorted.
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    return (collator.compare(va, vb) || collator.compare(ra.label, rb.label)) * sortDir;
  };
  const sorted = (ids: Id[]): Id[] => (sortCol ? [...ids].sort(cmp) : ids);

  const filtering = (): boolean => COLS.some((c) => filters[c.key] !== "");
  const matches = (r: Row): boolean => {
    for (const c of COLS) {
      const q = filters[c.key];
      if (!q) continue;
      const v = c.key === "iri" ? r.curie + " " + r.iri : value(r, c.key);
      if (!v.toLowerCase().includes(q)) return false;
    }
    return true;
  };
  // Which rows stay visible under the current filters: a match, or an ancestor of one.
  let visible: Set<Id> | null = null;
  let matchCount = 0;
  const computeVisible = () => {
    if (!filtering()) {
      visible = null;
      matchCount = total;
      return;
    }
    const vis = new Set<Id>();
    const hit = new Set<Id>();
    for (const id of all) if (matches(row(id))) hit.add(id);
    matchCount = hit.size;
    // Walk down from the roots; a node is visible when it or a descendant hits.
    const memo = new Map<Id, boolean>();
    const walk = (id: Id, path: Set<Id>): boolean => {
      const known = memo.get(id);
      if (known !== undefined) return known;
      if (path.has(id)) return false;
      path.add(id);
      let any = hit.has(id);
      for (const c of row(id).children) if (walk(c, path)) any = true;
      path.delete(id);
      memo.set(id, any);
      if (any) vis.add(id);
      return any;
    };
    for (const r of roots) walk(r, new Set());
    visible = vis;
    hitSet = hit;
  };
  let hitSet = new Set<Id>();

  // ----- table ----------------------------------------------------------------
  const sortButtons = new Map<Col, HTMLButtonElement>();
  const head = h("tr", null, COLS.map((c) => {
    const b = h("button", { class: "sort", type: "button", title: `Sort by ${c.title.toLowerCase()}`, onClick: () => {
      if (sortCol !== c.key) {
        sortCol = c.key;
        sortDir = 1;
      } else if (sortDir === 1) sortDir = -1;
      else sortCol = null;
      render();
    } }, c.title, h("span", { class: "dir" }, icon("down"))) as HTMLButtonElement;
    sortButtons.set(c.key, b);
    return h("th", { class: `c-${c.key}` }, b);
  }));
  const filterRow = h("tr", { class: "filters" }, COLS.map((c) => {
    const inp = h("input", { class: "input", type: "search", placeholder: "Filter…", "aria-label": `Filter by ${c.title.toLowerCase()}`, onInput: () => {
      filters[c.key] = inp.value.trim().toLowerCase();
      render();
    } }) as HTMLInputElement;
    return h("td", { class: `c-${c.key}` }, inp);
  }));
  const tbody = h("tbody");
  const table = h("table", { class: "ptable ctable" }, h("thead", null, head, filterRow), tbody);
  const status = h("p", { class: "muted ctable-status" });

  const expandBtn = h("button", { class: "btn ghost", type: "button", onClick: () => {
    allOpen = !allOpen;
    expanded.clear();
    render();
  } }) as HTMLButtonElement;

  const isOpen = (id: Id): boolean => {
    if (visible) return true; // filtering shows the matches' ancestors expanded
    return allOpen ? !expanded.has(id) : expanded.has(id);
  };
  const toggle = (id: Id) => {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  };

  const cell = (r: Row, depth: number, path: Set<Id>): HTMLTableRowElement => {
    const kids = visible ? r.children.filter((c) => visible!.has(c)) : r.children;
    const canOpen = kids.length > 0 && !path.has(r.id);
    const open = canOpen && isOpen(r.id);
    const tw = h("button", { class: `twisty${canOpen ? "" : " leaf"}${open ? " open" : ""}`, type: "button", "aria-label": open ? "Collapse" : "Expand", "aria-expanded": canOpen ? String(open) : undefined, onClick: () => toggle(r.id) }, icon("chevron"));
    const tr = h(
      "tr",
      { class: `${visible && !hitSet.has(r.id) ? "ctx" : ""}${r.deprecated ? " deprecated-row" : ""}`, dataset: { depth: String(depth) } },
      h("td", { class: "c-iri", style: { paddingLeft: `${12 + depth * 18}px` } }, tw, h("a", { class: "mono", href: ctx.href(r.id), title: r.iri, onClick: navTo(ctx, r.id) }, r.curie), canOpen ? h("span", { class: "count" }, `(${kids.length})`) : null),
      h("td", { class: "c-notation mono" }, r.notation),
      h("td", { class: "c-label" }, link(ctx, r.id), r.deprecated ? h("span", { class: "badge warn", style: { marginLeft: "6px" } }, "deprecated") : null, foreignScheme(r.id) !== undefined ? h("span", { class: "badge src", style: { marginLeft: "6px" }, title: "This concept belongs to another scheme" }, m.label(foreignScheme(r.id)!)) : null),
      h("td", { class: "c-definition" }, r.definition ? h("span", { class: "desc", title: r.definition.length > 160 ? r.definition : undefined }, r.definition) : null)
    );
    return tr;
  };

  const renderLevel = (ids: Id[], parent: Id, depth: number, path: Set<Id>, out: HTMLElement[]) => {
    const list = sorted(visible ? ids.filter((c) => visible!.has(c)) : ids);
    const limit = Math.min(list.length, PAGE + (shown.get(parent) ?? 0));
    for (const id of list.slice(0, limit)) {
      const r = row(id);
      out.push(cell(r, depth, path));
      if (r.children.length && !path.has(id) && isOpen(id)) {
        path.add(id);
        renderLevel(r.children, id, depth + 1, path, out);
        path.delete(id);
      }
    }
    if (list.length > limit) {
      const rest = list.length - limit;
      out.push(
        h("tr", { class: "more-row" }, h("td", { colspan: COLS.length, style: { paddingLeft: `${12 + depth * 18 + 24}px` } }, h("button", { class: "chip more", type: "button", onClick: () => {
          shown.set(parent, (shown.get(parent) ?? 0) + PAGE);
          render();
        } }, `+${rest.toLocaleString()} more`)))
      );
    }
  };

  const render = () => {
    computeVisible();
    for (const [c, b] of sortButtons) {
      b.classList.toggle("asc", sortCol === c && sortDir === 1);
      b.classList.toggle("desc", sortCol === c && sortDir === -1);
      b.setAttribute("aria-sort", sortCol === c ? (sortDir === 1 ? "ascending" : "descending") : "none");
    }
    const out: HTMLElement[] = [];
    renderLevel(roots, -1, 0, new Set(), out);
    tbody.replaceChildren(...out);
    if (out.length === 0) tbody.appendChild(h("tr", null, h("td", { class: "muted", colspan: COLS.length }, "No concept matches.")));
    expandBtn.replaceChildren(icon(allOpen ? "minimize" : "maximize"), allOpen ? "Collapse all" : "Expand all");
    expandBtn.disabled = visible !== null;
    status.textContent = visible ? `${matchCount.toLocaleString()} of ${total.toLocaleString()} concepts match` : "";
    status.hidden = !visible;
  };

  render();
  const wrap = h("div", { class: "ctable-wrap" }, status, h("div", { class: "table-scroll" }, table));
  return Object.assign(wrap, { tools: [expandBtn] as HTMLElement[] });
}

function navTo(ctx: AppCtx, id: Id): EventListener {
  return ((ev: MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
    ev.preventDefault();
    ctx.go(id);
  }) as EventListener;
}
