// Detail pages for properties, schemes, concepts, shapes and everything else.
import type { AppCtx } from "../ctx";
import { h, icon, plural } from "../dom";
import { KIND_LABEL, type Entity, type Id, type PropRow } from "../model";
import { annotations, chip, chips, constraintLine, link, pageHead, propTable, section } from "./common";

export function propertyPage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const pi = m.prop(e.id) ?? {};
  const page = h("div");
  const badges = (pi.characteristics ?? []).map((c) => h("span", { class: "badge" }, c));
  page.appendChild(pageHead(ctx, e, badges));
  const dl = h("dl", { class: "kv" });
  const domain = pi.domain ?? [];
  const range = pi.range ?? [];
  dl.append(h("dt", null, "Domain"), h("dd", null, domain.length ? chips(ctx, domain) : h("span", { class: "faint" }, "not stated")));
  dl.append(
    h("dt", null, "Range"),
    h("dd", null, pi.scheme !== undefined ? h("span", null, "a concept from ", chip(ctx, pi.scheme), " ") : null, range.length ? chips(ctx, range) : pi.scheme === undefined ? h("span", { class: "faint" }, "not stated") : null)
  );
  if ((pi.superProperties ?? []).length) dl.append(h("dt", null, "Subproperty of"), h("dd", null, chips(ctx, pi.superProperties!)));
  if ((pi.subProperties ?? []).length) dl.append(h("dt", null, "Subproperties"), h("dd", null, chips(ctx, pi.subProperties!)));
  if ((pi.inverseOf ?? []).length) dl.append(h("dt", null, "Inverse of"), h("dd", null, chips(ctx, pi.inverseOf!)));
  if ((pi.equivalent ?? []).length) dl.append(h("dt", null, "Equivalent to"), h("dd", null, chips(ctx, pi.equivalent!)));
  page.appendChild(h("div", { class: "card" }, dl));

  // Where it is used: one row per class, with the constraints that class puts on it.
  const used = pi.usedByClasses ?? [];
  if (used.length) {
    page.appendChild(section("Used by classes", { count: used.length }));
    const rows: { cls: Id; row: PropRow }[] = [];
    for (const c of used) {
      const r = m.cls(c)?.props?.find((x) => x.property === e.id && x.inheritedFrom === undefined && !x.inverse);
      if (r) rows.push({ cls: c, row: r });
    }
    const table = h("table", { class: "ptable" }, h("thead", null, h("tr", null, h("th", null, "Class"), h("th", null, "Expected value"), h("th", null, "Card."), h("th", null, "Constraints"), h("th", null, "From"))));
    const tb = h("tbody");
    for (const { cls, row } of rows) {
      const cons = row.constraints ?? [];
      tb.appendChild(
        h(
          "tr",
          null,
          h("td", { class: "pname" }, link(ctx, cls)),
          h("td", null, m.rowRange(row) || h("span", { class: "faint" }, "any")),
          h("td", { class: "mult" }, row.min === undefined && row.max === undefined ? "" : `${row.min ?? 0}..${row.max ?? "*"}`),
          h("td", null, cons.length ? h("ul", { class: "cons" }, cons.slice(0, 6).map((c) => constraintLine(ctx, c))) : null),
          h("td", null, (row.sources ?? []).map((s) => h("span", { class: "badge src" }, s)))
        )
      );
    }
    table.appendChild(tb);
    page.appendChild(table);
  }
  if ((pi.usedByShapes ?? []).length) {
    page.appendChild(section("In shapes", { count: pi.usedByShapes!.length }));
    page.appendChild(chips(ctx, pi.usedByShapes!));
  }
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  return page;
}

export function schemePage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const si = m.scheme(e.id) ?? {};
  const page = h("div");
  page.appendChild(pageHead(ctx, e, [h("span", { class: "badge" }, plural((si.concepts ?? []).length, "concept"))]));
  if ((si.usedBy ?? []).length) {
    page.appendChild(h("div", { class: "card" }, h("dl", { class: "kv" }, h("dt", null, "Values for"), h("dd", null, chips(ctx, si.usedBy!, { max: 30 })))));
  }
  const filter = h("input", { class: "input", type: "search", placeholder: "Filter concepts…", style: { maxWidth: "280px" } }) as HTMLInputElement;
  const treeHost = h("div", { class: "ctree" });
  const renderTree = () => {
    treeHost.replaceChildren();
    const q = filter.value.trim();
    if (q) {
      const hits = m.search(q, { kinds: new Set(["concept"]), scheme: e.id, limit: 200 });
      if (hits.length === 0) treeHost.appendChild(h("p", { class: "muted" }, "No concept matches."));
      else treeHost.appendChild(h("ul", null, hits.map((id) => h("li", null, conceptRow(ctx, id, false)))));
      return;
    }
    const top = si.topConcepts ?? [];
    treeHost.appendChild(conceptList(ctx, top, 0));
  };
  filter.addEventListener("input", renderTree);
  page.appendChild(section("Concepts", { count: (si.concepts ?? []).length, tools: [filter] }));
  page.appendChild(treeHost);
  renderTree();
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  return page;
}

function conceptList(ctx: AppCtx, ids: Id[], depth: number): HTMLElement {
  const ul = h("ul");
  const LIMIT = 300;
  const render = (n: number) => {
    ul.replaceChildren();
    for (const id of ids.slice(0, n)) ul.appendChild(conceptItem(ctx, id, depth));
    if (ids.length > n) ul.appendChild(h("li", null, h("button", { class: "chip more", type: "button", onClick: () => render(ids.length) }, `+${ids.length - n} more`)));
  };
  render(LIMIT);
  return ul;
}

function conceptItem(ctx: AppCtx, id: Id, depth: number): HTMLElement {
  const ci = ctx.m.concept(id);
  const narrower = ci?.narrower ?? [];
  const li = h("li");
  let open = false;
  let child: HTMLElement | null = null;
  const tw = h("button", { class: `twisty${narrower.length ? "" : " leaf"}`, type: "button", "aria-label": "expand", onClick: () => {
    open = !open;
    tw.classList.toggle("open", open);
    if (open && !child) {
      child = conceptList(ctx, narrower, depth + 1);
      li.appendChild(child);
    } else if (child) child.hidden = !open;
  } }, icon("chevron"));
  li.appendChild(h("div", { class: "row" }, tw, conceptRow(ctx, id, true)));
  if (depth === 0 && narrower.length && narrower.length <= 12) tw.click();
  return li;
}

function conceptRow(ctx: AppCtx, id: Id, withCount: boolean): HTMLElement {
  const ci = ctx.m.concept(id);
  const e = ctx.m.entity(id);
  return h("span", null, link(ctx, id), e.deprecated ? h("span", { class: "badge warn", style: { marginLeft: "6px" } }, "deprecated") : null, ci?.notation?.length ? h("span", { class: "notation" }, ci.notation.join(", ")) : null, withCount && (ci?.narrower ?? []).length ? h("span", { class: "count" }, `(${ci!.narrower!.length})`) : null);
}

export function conceptPage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const ci = m.concept(e.id) ?? {};
  const page = h("div");
  // Breadcrumbs: scheme › broader chain.
  const crumbs = h("div", { class: "crumbs" });
  for (const sid of (ci.schemes ?? []).slice(0, 1)) crumbs.append(link(ctx, sid), h("span", { class: "sep" }, "›"));
  const chain: Id[] = [];
  let cur: Id | undefined = (ci.broader ?? [])[0];
  const seen = new Set<Id>();
  while (cur !== undefined && !seen.has(cur) && chain.length < 12) {
    seen.add(cur);
    chain.unshift(cur);
    cur = (m.concept(cur)?.broader ?? [])[0];
  }
  for (const b of chain) crumbs.append(link(ctx, b), h("span", { class: "sep" }, "›"));
  crumbs.append(h("span", null, m.label(e)));
  if (crumbs.childElementCount > 1) page.appendChild(crumbs);
  page.appendChild(pageHead(ctx, e, (ci.notation ?? []).map((n) => h("span", { class: "badge mono" }, n))));
  const dl = h("dl", { class: "kv" });
  if ((ci.schemes ?? []).length) dl.append(h("dt", null, "In scheme"), h("dd", null, chips(ctx, ci.schemes!)));
  if ((ci.broader ?? []).length) dl.append(h("dt", null, "Broader"), h("dd", null, chips(ctx, ci.broader!)));
  if ((ci.narrower ?? []).length) dl.append(h("dt", null, plural(ci.narrower!.length, "Narrower concept")), h("dd", null, chips(ctx, ci.narrower!, { max: 40 })));
  if ((ci.related ?? []).length) dl.append(h("dt", null, "Related"), h("dd", null, chips(ctx, ci.related!)));
  if ((ci.collections ?? []).length) dl.append(h("dt", null, "In collections"), h("dd", null, chips(ctx, ci.collections!)));
  if (ci.altLabels && Object.keys(ci.altLabels).length) {
    dl.append(h("dt", null, "Also called"), h("dd", null, Object.entries(ci.altLabels).map(([l, vs], i) => h("span", null, i ? " · " : "", vs.join(", "), l ? h("span", { class: "faint" }, ` @${l}`) : null))));
  }
  if ((ci.mappings ?? []).length) {
    dl.append(h("dt", null, "Mappings"), h("dd", null, ci.mappings!.map(([k, iri]) => h("div", null, h("span", { class: "faint mono" }, k + " "), h("a", { href: iri, target: "_blank", rel: "noopener" }, iri)))));
  }
  page.appendChild(h("div", { class: "card" }, dl));
  // Which properties take this value.
  const usedBy = new Set<Id>();
  for (const sid of ci.schemes ?? []) for (const p of m.scheme(sid)?.usedBy ?? []) usedBy.add(p);
  if (usedBy.size) {
    page.appendChild(section("A value for", { count: usedBy.size }));
    page.appendChild(chips(ctx, [...usedBy]));
  }
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  return page;
}

export function shapePage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const si = m.shape(e.id) ?? {};
  const page = h("div");
  const badges = [];
  if (si.closed) badges.push(h("span", { class: "badge" }, "closed"));
  if (si.deactivated) badges.push(h("span", { class: "badge warn" }, "deactivated"));
  if (si.severity && si.severity !== "Violation") badges.push(h("span", { class: "badge" }, si.severity));
  page.appendChild(pageHead(ctx, e, badges));
  const dl = h("dl", { class: "kv" });
  const targets: Id[] = [...(si.targetClass ?? [])];
  if (si.implicitTarget) targets.push(e.id);
  if (targets.length) dl.append(h("dt", null, "Applies to instances of"), h("dd", null, chips(ctx, targets)));
  if ((si.applicableTo ?? []).length) dl.append(h("dt", null, "Linked from classes"), h("dd", null, chips(ctx, si.applicableTo!)));
  if ((si.targetSubjectsOf ?? []).length) dl.append(h("dt", null, "Applies to subjects of"), h("dd", null, chips(ctx, si.targetSubjectsOf!)));
  if ((si.targetObjectsOf ?? []).length) dl.append(h("dt", null, "Applies to objects of"), h("dd", null, chips(ctx, si.targetObjectsOf!)));
  if ((si.targetNode ?? []).length) dl.append(h("dt", null, "Applies to nodes"), h("dd", null, si.targetNode!.join(", ")));
  if ((si.usedBy ?? []).length) dl.append(h("dt", null, "Referenced by shapes"), h("dd", null, chips(ctx, si.usedBy!)));
  if ((si.messages ?? []).length) dl.append(h("dt", null, "Message"), h("dd", null, si.messages!.map((x) => h("div", { class: "muted" }, x))));
  if (dl.childElementCount === 0) dl.append(h("dt", null, "Targets"), h("dd", { class: "faint" }, "none declared; used through sh:node from other shapes"));
  page.appendChild(h("div", { class: "card" }, dl));
  const cons = si.constraints ?? [];
  if (cons.length) {
    page.appendChild(section("Node constraints", { count: cons.length }));
    page.appendChild(h("div", { class: "card" }, h("ul", { class: "cons", style: { fontSize: "13.5px" } }, cons.map((c) => constraintLine(ctx, c)))));
  }
  const props = si.properties ?? [];
  page.appendChild(section("Property shapes", { count: props.length }));
  page.appendChild(propTable(ctx, props, { showInherited: true, showHidden: true, showSource: false, forShape: true }));
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  return page;
}

export function genericPage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const page = h("div");
  page.appendChild(pageHead(ctx, e));
  const dl = h("dl", { class: "kv" });
  if (e.kind === "individual") {
    const ii = m.b.individuals[e.id];
    if (ii?.types?.length) dl.append(h("dt", null, "Type"), h("dd", null, chips(ctx, ii.types)));
  } else if (e.kind === "ontology") {
    const oi = m.b.ontologies[e.id];
    if (oi?.version) dl.append(h("dt", null, "Version"), h("dd", null, oi.version));
    if (oi?.versionIri) dl.append(h("dt", null, "Version IRI"), h("dd", null, h("a", { href: oi.versionIri, target: "_blank", rel: "noopener" }, oi.versionIri)));
    if (oi?.imports?.length) dl.append(h("dt", null, "Imports"), h("dd", null, oi.imports.map((i) => h("div", null, h("a", { href: i, target: "_blank", rel: "noopener" }, i)))));
  } else if (e.kind === "collection") {
    const co = m.b.collections[e.id];
    if (co?.members?.length) dl.append(h("dt", null, plural(co.members.length, "Member")), h("dd", null, chips(ctx, co.members, { max: 60 })));
  } else if (e.kind === "propertyGroup") {
    const gi = m.b.groups[e.id];
    if (gi?.order !== undefined) dl.append(h("dt", null, "Order"), h("dd", null, String(gi.order)));
    const users: Id[] = [];
    for (const [k, ci] of Object.entries(m.b.classes)) if (ci.props?.some((r) => r.group === e.id && r.inheritedFrom === undefined)) users.push(Number(k));
    if (users.length) dl.append(h("dt", null, "Used by classes"), h("dd", null, chips(ctx, users)));
  } else if (e.kind === "datatype") {
    const users: Id[] = [];
    for (const [k, pi] of Object.entries(m.b.properties)) if (pi.range?.includes(e.id)) users.push(Number(k));
    if (users.length) dl.append(h("dt", null, "Range of"), h("dd", null, chips(ctx, users, { max: 60 })));
  } else if (e.kind === "annotationProperty") {
    dl.append(h("dt", null, "Kind"), h("dd", null, KIND_LABEL[e.kind]));
  } else if (e.kind === "propertyShape") {
    // Standalone property shapes: find the node shapes listing them.
    const users: Id[] = [];
    for (const [k, si] of Object.entries(m.b.shapes)) if (si.properties?.some((r) => (r.shapes ?? []).includes(Number(k)) && r.path && false)) users.push(Number(k));
    dl.append(h("dt", null, "Kind"), h("dd", null, "SHACL property shape"));
  }
  if (dl.childElementCount) page.appendChild(h("div", { class: "card" }, dl));
  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  return page;
}
