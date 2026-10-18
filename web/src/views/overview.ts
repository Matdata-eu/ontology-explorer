// The map of all classes.
import type { AppCtx } from "../ctx";
import { Diagram } from "../diagram";
import { button, copyText, h } from "../dom";
import { classActions, fullscreenButton, parseView, viewParam } from "./diagramPanel";
import { buildOverview, classNamespaces, toMermaid, toPlantUml, type GraphSpec, type OverviewOptions } from "../graph";

export function overviewPage(ctx: AppCtx): HTMLElement {
  const m = ctx.m;
  const page = h("div");
  const nsList = classNamespaces(m);
  const P = ctx.route.params;
  const o: OverviewOptions = { associations: P.assoc === "1", externals: P.ext === "1", namespace: P.ns || undefined, maxNodes: 220 };
  let view = parseView(P.view);
  let restoreView = view !== undefined;
  const sync = () => ctx.setParams({ assoc: o.associations ? "1" : undefined, ext: o.externals ? "1" : undefined, ns: o.namespace, view: viewParam(view ?? null) });
  page.appendChild(h("div", { class: "page-head" }, h("h1", null, "Overview"), h("span", { class: "muted" }, "every class and how they relate")));
  const wrap = h("div", { class: "diagram tall" });
  const status = h("div", { class: "status" });
  const statusText = h("span");
  status.append(statusText, h("div", { class: "legend hide-mobile" }, h("span", { class: "gen" }, "is a"), h("span", { class: "assoc" }, "has")));
  const overlay = h("div", { class: "overlay" }, "Laying out the whole model… (large ontologies take a few seconds)");
  const d = new Diagram(wrap, { onNavigate: (id) => ctx.go(id), onExpand: (id) => ctx.go(id), nodeMenu: (id) => classActions(ctx, id), onStatus: (t) => (statusText.textContent = t), onViewChange: (v) => {
    view = v ?? undefined;
    sync();
  } });
  let graph: GraphSpec | null = null;
  const run = () => {
    wrap.appendChild(overlay);
    graph = buildOverview(m, o);
    const algorithm = o.associations && graph.nodes.length > 60 ? "stress" : "layered";
    const start = restoreView ? view : undefined;
    restoreView = false;
    sync();
    d.render(graph, { direction: "DOWN", algorithm, view: start }).finally(() => overlay.remove());
  };
  const assocBtn = button("Associations", () => {
    o.associations = !o.associations;
    assocBtn.setAttribute("aria-pressed", String(o.associations));
    run();
  }, { cls: "small", pressed: o.associations, title: "Also draw the links between classes (slower)" });
  const extBtn = button("External", () => {
    o.externals = !o.externals;
    extBtn.setAttribute("aria-pressed", String(o.externals));
    run();
  }, { cls: "small", pressed: o.externals, title: "Include classes from other vocabularies" });
  const nsSel = h("select", { class: "input", style: { padding: "2px 6px", fontSize: "12px" } }, h("option", { value: "" }, "All namespaces"), nsList.map((n) => h("option", { value: n.ns }, `${n.prefix} (${n.count})`))) as HTMLSelectElement;
  nsSel.value = o.namespace ?? "";
  nsSel.addEventListener("change", () => {
    o.namespace = nsSel.value || undefined;
    run();
  });
  const exportMenu = h("div", { class: "menu", hidden: true, style: { top: "44px", right: "8px" } });
  const item = (label: string, fn: () => void) => h("button", { type: "button", onClick: () => {
    exportMenu.hidden = true;
    fn();
  } }, label);
  exportMenu.append(h("div", { class: "mh" }, "Export the map"), item("SVG image", () => d.downloadSvg("overview")), item("PNG image (2×)", () => d.downloadPng("overview")), item("Copy PlantUML", () => graph && copyText(toPlantUml(graph)).then(() => ctx.toast("PlantUML copied"))), item("Copy Mermaid", () => graph && copyText(toMermaid(graph)).then(() => ctx.toast("Mermaid copied"))));
  const tools = h(
    "div",
    { class: "dtools" },
    assocBtn,
    extBtn,
    nsList.length > 1 ? nsSel : null,
    h("span", { class: "spacer" }),
    h("div", { class: "btn-group" }, button("", () => d.zoomBy(1.25), { cls: "small icon-only", icon: "plus", title: "Zoom in" }), button("", () => d.zoomBy(0.8), { cls: "small icon-only", icon: "minus", title: "Zoom out" }), button("", () => d.fit(), { cls: "small icon-only", icon: "fit", title: "Fit" })),
    fullscreenButton(wrap),
    button("Export", () => (exportMenu.hidden = !exportMenu.hidden), { cls: "small", icon: "download" })
  );
  wrap.append(tools, exportMenu, status);
  page.appendChild(wrap);
  page.appendChild(h("p", { class: "faint", style: { fontSize: "12px", marginTop: "6px" } }, "Hierarchy only by default. Click a class to open its diagram or table. Very large models show the most connected classes first."));
  queueMicrotask(run);
  return page;
}
