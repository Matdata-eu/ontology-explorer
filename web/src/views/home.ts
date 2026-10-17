// The start page: what is loaded, where to begin; or how to load something.
import type { AppCtx } from "../ctx";
import { button, h, plural } from "../dom";
import { classNamespaces } from "../graph";
import type { Model } from "../model";
import { chips, link, section } from "./common";

export function homePage(ctx: AppCtx): HTMLElement {
  const m = ctx.m;
  const b = m.b;
  const st = b.stats;
  const page = h("div");
  const ont = Object.keys(b.ontologies).map(Number)[0];
  page.appendChild(h("div", { class: "page-head" }, h("h1", null, b.title ?? "Ontology"), ont !== undefined ? h("span", { class: "badge" }, m.entity(ont).curie) : null));
  const desc = ont !== undefined ? m.comment(ont) : "";
  if (desc) {
    const lead = h("p", { class: "lead clamp" }, desc);
    page.appendChild(lead);
    if (desc.length > 320) page.appendChild(h("button", { class: "linkish", type: "button", onClick: (ev: Event) => {
      lead.classList.toggle("clamp");
      (ev.target as HTMLElement).textContent = lead.classList.contains("clamp") ? "Read more" : "Show less";
    } }, "Read more"));
  }
  const files = b.sources.map((s) => s.name);
  page.appendChild(
    files.length <= 4
      ? h("p", { class: "muted", style: { fontSize: "12.5px" } }, `${plural(st.triples, "triple")} from ${files.join(", ")}`)
      : h("details", { class: "muted", style: { fontSize: "12.5px", margin: "8px 0" } }, h("summary", null, `${plural(st.triples, "triple")} from ${plural(files.length, "file")}`), h("div", { style: { marginTop: "4px" } }, files.join(", ")))
  );

  const stat = (n: number, label: string, onClick?: () => void) => (n ? h("button", { class: "stat", type: "button", onClick }, h("div", { class: "n" }, n.toLocaleString()), h("div", { class: "l" }, label)) : null);
  page.appendChild(
    h(
      "div",
      { class: "stats" },
      stat(st.classes, "classes", () => ctx.goRoute({ view: "overview" })),
      stat(st.objectProperties, "object properties"),
      stat(st.datatypeProperties, "datatype properties"),
      stat(st.conceptSchemes, "concept schemes"),
      stat(st.concepts, "concepts"),
      stat(st.nodeShapes, "node shapes"),
      stat(st.propertyShapes, "property shapes"),
      stat(st.individuals, "individuals")
    )
  );
  const notes: string[] = [];
  if (st.usesShacl) notes.push(st.usesDash ? "SHACL shapes with DASH annotations organise the property tables and diagrams." : "SHACL shapes are merged into the property tables (no DASH annotations found).");
  else notes.push("No SHACL shapes: cardinalities and value sets come from the ontology only.");
  if (st.usesSkos) notes.push("Concept schemes appear as value sets in diagrams and under Vocabularies.");
  page.appendChild(h("p", { class: "muted" }, notes.join(" ")));

  if (st.classes) {
    page.appendChild(section("Start here", { tools: [button("Overview map", () => ctx.goRoute({ view: "overview" }), { icon: "map", cls: "small" })] }));
    const starters = startClasses(m);
    page.appendChild(chips(ctx, starters, { max: 30 }));
    const ns = classNamespaces(m);
    if (ns.length > 1) {
      page.appendChild(section("Namespaces"));
      page.appendChild(h("ul", { style: { margin: "0", paddingLeft: "18px" } }, ns.slice(0, 12).map((n) => h("li", null, h("code", null, String(n.prefix)), " ", h("span", { class: "muted" }, `${n.count} classes`), " ", h("span", { class: "faint mono", style: { fontSize: "11.5px" } }, n.ns)))));
    }
  }
  if (st.conceptSchemes) {
    const schemes = Object.keys(b.schemes).map(Number).sort((a, c) => (m.scheme(c)?.usedBy?.length ?? 0) - (m.scheme(a)?.usedBy?.length ?? 0) || m.label(a).localeCompare(m.label(c), undefined, { numeric: true }));
    page.appendChild(section("Vocabularies", { count: schemes.length }));
    page.appendChild(chips(ctx, schemes, { max: 24 }));
  }
  if (ont !== undefined) {
    page.appendChild(section("About this ontology"));
    page.appendChild(h("p", null, "Metadata, imports and version: ", link(ctx, ont)));
  }
  return page;
}

/** Classes worth opening first: most connected, defined here, not deprecated. */
export function startClasses(m: Model): number[] {
  const scored = Object.entries(m.b.classes).map(([k, ci]) => {
    const id = Number(k);
    let s = (ci.ownProps ?? 0) + (ci.subClasses?.length ?? 0) * 3 + (ci.referencedBy?.length ?? 0) * 2;
    if (m.isExternal(id)) s -= 1000;
    if (m.entity(id).deprecated) s -= 100;
    return { id, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s > 0).map((x) => x.id);
}
