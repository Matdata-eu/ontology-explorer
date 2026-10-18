// The diagram with its toolbar: options, zoom, export.
import type { AppCtx } from "../ctx";
import { Diagram, type NodeAction, type View } from "../diagram";
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

/** A button that gives the diagram the whole screen, and back. */
export function fullscreenButton(wrap: HTMLElement): HTMLButtonElement {
  const isFull = () => wrap.matches(":fullscreen") || wrap.classList.contains("fs");
  const sync = () => {
    const full = isFull();
    btn.replaceChildren(icon(full ? "minimize" : "maximize"));
    btn.title = full ? "Leave full screen (Esc)" : "Full screen";
    btn.setAttribute("aria-pressed", String(full));
  };
  const btn = button("", () => {
    if (isFull()) {
      if (wrap.classList.contains("fs")) wrap.classList.remove("fs");
      else void document.exitFullscreen();
    } else if (wrap.requestFullscreen) {
      // Without the Fullscreen API (iPhone Safari), the diagram covers the page instead.
      wrap.requestFullscreen().catch(() => wrap.classList.add("fs"));
    } else wrap.classList.add("fs");
    setTimeout(sync, 100);
  }, { cls: "small icon-only", icon: "maximize", title: "Full screen" });
  wrap.addEventListener("fullscreenchange", sync);
  wrap.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && wrap.classList.contains("fs")) {
      wrap.classList.remove("fs");
      sync();
    }
  });
  return btn;
}

/** The pan and zoom kept in a link ("tx,ty,scale"). */
export const viewParam = (v: View | null): string | undefined => (v ? [v.tx, v.ty, v.scale].map((n) => +n.toFixed(3)).join(",") : undefined);
export function parseView(s: string | undefined): View | undefined {
  const n = (s ?? "").split(",").map(Number);
  return n.length === 3 && n.every(Number.isFinite) && n[2] > 0 ? { tx: n[0], ty: n[1], scale: n[2] } : undefined;
}

export function diagramPanel(ctx: AppCtx, focus: Id, opts: { tall?: boolean } = {}): DiagramPanel {
  const m = ctx.m;
  const p = ctx.prefs;
  // The link to this view carries the diagram's options; without them, the preferences apply.
  const P = ctx.route.params;
  const flag = (k: string, def: boolean) => (P[k] === undefined ? def : P[k] === "1");
  const ids = (k: string) => new Set((P[k] ?? "").split(" ").map((iri) => (iri ? m.id(iri) : undefined)).filter((id): id is Id => id !== undefined));
  const base = defaultNeighborhood(focus);
  const o: NeighborhoodOptions = {
    ...base,
    depth: P.depth === "2" ? 2 : P.depth === "1" ? 1 : p.depth,
    attributes: P.attrs === "all" || P.attrs === "none" || P.attrs === "focus" ? P.attrs : p.attributes,
    inherited: flag("inh", p.showInherited),
    incoming: flag("inc", p.incoming),
    subclasses: flag("sub", base.subclasses),
    schemes: flag("vs", p.schemes),
    hidden: p.showHidden,
    expanded: ids("x"),
    openAttrs: ids("open"),
  };
  let direction: "DOWN" | "RIGHT" = P.dir === "right" ? "RIGHT" : P.dir === "down" ? "DOWN" : p.direction;
  let view: View | undefined = parseView(P.view);
  let restoreView = view !== undefined;
  const iris = (set: Set<Id>) => [...set].map((id) => m.entity(id).iri).join(" ");
  const bit = (v: boolean) => (v ? "1" : "0");
  const sync = () =>
    ctx.setParams({
      depth: String(o.depth),
      dir: direction.toLowerCase(),
      attrs: o.attributes,
      inh: bit(o.inherited),
      inc: bit(o.incoming),
      sub: bit(o.subclasses),
      vs: bit(o.schemes),
      x: iris(o.expanded),
      open: iris(o.openAttrs),
      view: viewParam(view ?? null),
    });
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
    onViewChange: (v) => {
      view = v ?? undefined;
      sync();
    },
  });
  let graph: GraphSpec | null = null;
  const run = (keepView = false) => {
    if (!overlay) {
      overlay = h("div", { class: "overlay" }, "Laying out…");
    }
    wrap.appendChild(overlay);
    graph = buildNeighborhood(m, o);
    // Only the first layout starts from the view in the link; later ones keep or fit the view.
    const start = restoreView ? view : undefined;
    restoreView = false;
    sync();
    d.render(graph, { direction, keepView, view: start }).finally(() => {
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
    direction = direction === "DOWN" ? "RIGHT" : "DOWN";
    ctx.setPrefs({ direction });
    run(false);
  }, { cls: "small icon-only", icon: "tree", title: "Flip layout direction" });
  const attrsSel = h("select", { class: "input", title: "Which boxes list their attributes (properties with a literal value; links to other classes are drawn as arrows)", style: { padding: "2px 6px", fontSize: "12px" } }, h("option", { value: "focus" }, "Attributes of this class"), h("option", { value: "all" }, "Attributes of every class"), h("option", { value: "none" }, "No attributes")) as HTMLSelectElement;
  attrsSel.value = o.attributes;
  attrsSel.addEventListener("change", () => {
    o.attributes = attrsSel.value as NeighborhoodOptions["attributes"];
    ctx.setPrefs({ attributes: o.attributes });
    run(true);
  });

  const { exportBtn, exportMenu } = exportControls(ctx, d, m.label(focus), () => graph, wrap);
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
    fullscreenButton(wrap),
    exportBtn
  );
  wrap.append(tools, exportMenu, status, overlay);
  refitOnResize(wrap, d);
  queueMicrotask(() => run(false));
  return { el: wrap, rerender: () => run(true) };
}

/** The Export button and its menu: images, PlantUML, Mermaid and the link to the view. */
function exportControls(ctx: AppCtx, d: Diagram, label: string, graph: () => GraphSpec | null, wrap: HTMLElement) {
  const exportMenu = h("div", { class: "menu", hidden: true });
  const exportBtn = button("Export", () => {
    exportMenu.hidden = !exportMenu.hidden;
    exportMenu.style.top = "44px";
    exportMenu.style.right = "8px";
  }, { cls: "small", icon: "download" });
  const name = label.replace(/[^\w.-]+/g, "_");
  const item = (text: string, fn: () => void) =>
    h("button", { type: "button", onClick: () => {
      exportMenu.hidden = true;
      fn();
    } }, text);
  const copy = (what: string, text: () => string | undefined) => {
    const t = text();
    if (t !== undefined) void copyText(t).then((ok) => ctx.toast(ok ? `${what} copied` : "Could not copy"));
  };
  exportMenu.append(
    h("div", { class: "mh" }, "Export this diagram"),
    item("SVG image", () => d.downloadSvg(name)),
    item("PNG image (2×)", () => d.downloadPng(name)),
    item("Copy PlantUML", () => copy("PlantUML", () => { const g = graph(); return g ? toPlantUml(g) : undefined; })),
    item("Copy Mermaid", () => copy("Mermaid", () => { const g = graph(); return g ? toMermaid(g) : undefined; })),
    item("Copy link to this view", () => copy("Link", () => ctx.shareLink().url))
  );
  wrap.addEventListener("click", (ev) => {
    if (!exportMenu.hidden && !exportMenu.contains(ev.target as Node) && !exportBtn.contains(ev.target as Node)) exportMenu.hidden = true;
  });
  return { exportBtn, exportMenu };
}

/** Re-fit when the panel is resized by the user (CSS resize handle). */
function refitOnResize(wrap: HTMLElement, d: Diagram): void {
  let last = 0;
  new ResizeObserver(() => {
    const now = wrap.clientHeight;
    if (Math.abs(now - last) > 4) {
      last = now;
      d.fit();
    }
  }).observe(wrap);
}

/**
 * A diagram of a property or a shape: the graph comes from `build`, the toolbar
 * has layout, zoom, full screen and export. `open` is whether the focus box
 * lists all its attributes.
 */
export function entityDiagram(ctx: AppCtx, focus: Id, build: (open: boolean) => GraphSpec, legend: string): HTMLElement {
  const P = ctx.route.params;
  let direction: "DOWN" | "RIGHT" = P.dir === "right" ? "RIGHT" : P.dir === "down" ? "DOWN" : ctx.prefs.direction;
  let open = P.open === "1";
  let view: View | undefined = parseView(P.view);
  let restoreView = view !== undefined;
  const sync = () => ctx.setParams({ dir: direction.toLowerCase(), open: open ? "1" : undefined, view: viewParam(view ?? null) });
  const wrap = h("div", { class: "diagram small-diagram" });
  const statusText = h("span");
  const status = h("div", { class: "status" }, statusText, h("div", { class: "legend hide-mobile" }, legend));
  const overlay = h("div", { class: "overlay" }, "Laying out…");
  let graph: GraphSpec | null = null;
  const d = new Diagram(wrap, {
    onNavigate: (id) => id !== focus && ctx.go(id),
    nodeMenu: (id) => (id === focus ? [] : classActions(ctx, id)),
    onToggleAttrs: () => {
      open = !open;
      run(true);
    },
    onStatus: (t) => {
      statusText.textContent = t;
    },
    onViewChange: (v) => {
      view = v ?? undefined;
      sync();
    },
  });
  const run = (keepView = false) => {
    wrap.appendChild(overlay);
    graph = build(open);
    const start = restoreView ? view : undefined;
    restoreView = false;
    sync();
    d.render(graph, { direction, keepView, view: start }).finally(() => overlay.remove());
  };
  const dirBtn = button("", () => {
    direction = direction === "DOWN" ? "RIGHT" : "DOWN";
    ctx.setPrefs({ direction });
    run(false);
  }, { cls: "small icon-only", icon: "tree", title: "Flip layout direction" });
  const { exportBtn, exportMenu } = exportControls(ctx, d, ctx.m.label(focus), () => graph, wrap);
  const tools = h(
    "div",
    { class: "dtools" },
    dirBtn,
    h("span", { class: "spacer" }),
    h("div", { class: "btn-group" }, button("", () => d.zoomBy(1.25), { cls: "small icon-only", icon: "plus", title: "Zoom in" }), button("", () => d.zoomBy(0.8), { cls: "small icon-only", icon: "minus", title: "Zoom out" }), button("", () => d.fit(), { cls: "small icon-only", icon: "fit", title: "Fit" })),
    fullscreenButton(wrap),
    exportBtn
  );
  wrap.append(tools, exportMenu, status, overlay);
  refitOnResize(wrap, d);
  queueMicrotask(() => run(false));
  return wrap;
}
