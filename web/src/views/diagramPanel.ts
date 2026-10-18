// The diagram with its toolbar: options, zoom, export.
import type { AppCtx } from "../ctx";
import { Diagram, type NodeAction } from "../diagram";
import { button, copyText, h, icon } from "../dom";
import { buildNeighborhood, defaultNeighborhood, toMermaid, toPlantUml, type GraphSpec, type NeighborhoodOptions } from "../graph";
import type { Id } from "../model";

export interface DiagramPanel {
  el: HTMLElement;
  rerender(): void;
}

/** What a click on a box in a diagram offers: grow the diagram there, or go to it. */
export function classActions(ctx: AppCtx, id: Id, expand?: { expanded: boolean; toggle: () => void }): NodeAction[] {
  const actions: NodeAction[] = [];
  const isClass = ctx.m.entity(id).kind === "class";
  if (expand) actions.push({ label: expand.expanded ? "Remove its neighbours" : "Add its neighbours to this diagram", icon: expand.expanded ? "minus" : "plus", run: expand.toggle });
  if (isClass) {
    actions.push({ label: "Open its diagram", icon: "diagram", run: () => ctx.go(id, { tab: "diagram" }) });
    actions.push({ label: "Open its property table", icon: "table", run: () => ctx.go(id, { tab: "table" }) });
  } else actions.push({ label: "Open its page", icon: "external", run: () => ctx.go(id) });
  return actions;
}

export function diagramPanel(ctx: AppCtx, focus: Id, opts: { tall?: boolean } = {}): DiagramPanel {
  const m = ctx.m;
  const p = ctx.prefs;
  const o: NeighborhoodOptions = {
    ...defaultNeighborhood(focus),
    depth: p.depth,
    attributes: p.attributes,
    inherited: p.showInherited,
    incoming: p.incoming,
    schemes: p.schemes,
    hidden: p.showHidden,
  };
  const wrap = h("div", { class: `diagram${opts.tall ? " tall" : ""}` });
  const status = h("div", { class: "status" });
  const statusText = h("span");
  status.append(statusText, h("div", { class: "legend hide-mobile" }, h("span", { class: "gen" }, "is a"), h("span", { class: "assoc" }, "has"), h("span", { class: "comp" }, "contains")));
  let overlay: HTMLElement | null = h("div", { class: "overlay" }, "Laying out…");
  const expand = (id: Id) => {
    if (o.expanded.has(id)) o.expanded.delete(id);
    else o.expanded.add(id);
    run(true);
  };
  const d = new Diagram(wrap, {
    onNavigate: (id) => ctx.go(id),
    onExpand: expand,
    nodeMenu: (id) => classActions(ctx, id, id === focus ? undefined : { expanded: o.expanded.has(id), toggle: () => expand(id) }),
    onToggleAttrs: (id) => {
      if (o.openAttrs.has(id)) o.openAttrs.delete(id);
      else o.openAttrs.add(id);
      run(true);
    },
    onStatus: (t) => {
      statusText.textContent = t;
    },
  });
  let graph: GraphSpec | null = null;
  const run = (keepView = false) => {
    if (!overlay) {
      overlay = h("div", { class: "overlay" }, "Laying out…");
    }
    wrap.appendChild(overlay);
    graph = buildNeighborhood(m, o);
    d.render(graph, { direction: p.direction, keepView }).finally(() => {
      overlay?.remove();
      overlay = null;
    });
  };

  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, title?: string) => {
    const b = button(label, () => {
      set(!get());
      b.setAttribute("aria-pressed", String(get()));
      run(true);
    }, { cls: "small", pressed: get(), title });
    return b;
  };
  const depthBtn = button(`Depth ${o.depth}`, () => {
    o.depth = o.depth === 1 ? 2 : 1;
    depthBtn.querySelector("span")!.textContent = `Depth ${o.depth}`;
    ctx.setPrefs({ depth: o.depth });
    run(false);
  }, { cls: "small", title: "How many steps away from the focus class to show" });
  const dirBtn = button("", () => {
    ctx.setPrefs({ direction: ctx.prefs.direction === "DOWN" ? "RIGHT" : "DOWN" });
    run(false);
  }, { cls: "small icon-only", icon: "tree", title: "Flip layout direction" });
  const attrsSel = h("select", { class: "input", title: "Which boxes list their attributes (properties with a literal value; links to other classes are drawn as arrows)", style: { padding: "2px 6px", fontSize: "12px" } }, h("option", { value: "focus" }, "Attributes of this class"), h("option", { value: "all" }, "Attributes of every class"), h("option", { value: "none" }, "No attributes")) as HTMLSelectElement;
  attrsSel.value = o.attributes;
  attrsSel.addEventListener("change", () => {
    o.attributes = attrsSel.value as NeighborhoodOptions["attributes"];
    ctx.setPrefs({ attributes: o.attributes });
    run(true);
  });

  const exportMenu = h("div", { class: "menu", hidden: true });
  const exportBtn = button("Export", () => {
    exportMenu.hidden = !exportMenu.hidden;
    exportMenu.style.top = "44px";
    exportMenu.style.right = "8px";
  }, { cls: "small", icon: "download" });
  const name = m.label(focus).replace(/[^\w.-]+/g, "_");
  const item = (label: string, fn: () => void) =>
    h("button", { type: "button", onClick: () => {
      exportMenu.hidden = true;
      fn();
    } }, label);
  exportMenu.append(
    h("div", { class: "mh" }, "Export this diagram"),
    item("SVG image", () => d.downloadSvg(name)),
    item("PNG image (2×)", () => d.downloadPng(name)),
    item("Copy PlantUML", () => graph && copyText(toPlantUml(graph)).then((ok) => ctx.toast(ok ? "PlantUML copied" : "Could not copy"))),
    item("Copy Mermaid", () => graph && copyText(toMermaid(graph)).then((ok) => ctx.toast(ok ? "Mermaid copied" : "Could not copy"))),
    item("Copy link", () => copyText(location.href).then((ok) => ctx.toast(ok ? "Link copied" : "Could not copy")))
  );
  const tools = h(
    "div",
    { class: "dtools" },
    depthBtn,
    attrsSel,
    toggle("Inherited", () => o.inherited, (v) => {
      o.inherited = v;
      ctx.setPrefs({ showInherited: v });
    }, "Include inherited properties"),
    toggle("Incoming", () => o.incoming, (v) => {
      o.incoming = v;
      ctx.setPrefs({ incoming: v });
    }, "Show classes that point at this one"),
    toggle("Subclasses", () => o.subclasses, (v) => (o.subclasses = v)),
    m.b.stats.usesSkos ? toggle("Value sets", () => o.schemes, (v) => {
      o.schemes = v;
      ctx.setPrefs({ schemes: v });
    }, "Show concept schemes used as value sets") : null,
    dirBtn,
    h("span", { class: "spacer" }),
    h("div", { class: "btn-group" }, button("", () => d.zoomBy(1.25), { cls: "small icon-only", icon: "plus", title: "Zoom in" }), button("", () => d.zoomBy(0.8), { cls: "small icon-only", icon: "minus", title: "Zoom out" }), button("", () => d.fit(), { cls: "small icon-only", icon: "fit", title: "Fit" })),
    exportBtn
  );
  wrap.append(tools, exportMenu, status, overlay);
  wrap.addEventListener("click", (ev) => {
    if (!exportMenu.hidden && !exportMenu.contains(ev.target as Node) && ev.target !== exportBtn && !exportBtn.contains(ev.target as Node)) exportMenu.hidden = true;
  });
  // Re-fit when the panel is resized by the user (CSS resize handle).
  let last = 0;
  new ResizeObserver(() => {
    const now = wrap.clientHeight;
    if (Math.abs(now - last) > 4) {
      last = now;
      d.fit();
    }
  }).observe(wrap);
  queueMicrotask(() => run(false));
  void icon;
  return { el: wrap, rerender: () => run(true) };
}
