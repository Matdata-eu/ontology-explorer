import type { AppCtx } from "../ctx";
import { button, h, plural } from "../dom";
import type { Entity } from "../model";
import { annotations, chips, link, pageHead, propTable, section } from "./common";
import { diagramPanel } from "./diagramPanel";

export function classPage(ctx: AppCtx, e: Entity): HTMLElement {
  const m = ctx.m;
  const ci = m.cls(e.id) ?? {};
  const page = h("div");
  const shapeBadges = (ci.shapes ?? []).length ? [h("span", { class: "badge k-nodeShape", title: "SHACL shapes apply to this class" }, `${ci.shapes!.length} shape${ci.shapes!.length > 1 ? "s" : ""}`)] : [];
  page.appendChild(pageHead(ctx, e, shapeBadges, { abstract: ci.abstract }));

  // Hierarchy line.
  const supers = ci.superClasses ?? [];
  const subs = ci.subClasses ?? [];
  if (supers.length || subs.length || (ci.equivalent ?? []).length || (ci.unionOf ?? []).length) {
    const dl = h("dl", { class: "kv" });
    if (supers.length) dl.append(h("dt", null, "Subclass of"), h("dd", null, chips(ctx, supers)));
    if ((ci.ancestors ?? []).length > supers.length) dl.append(h("dt", null, "All ancestors"), h("dd", null, chips(ctx, ci.ancestors!, { max: 12 })));
    if (subs.length) dl.append(h("dt", null, plural(subs.length, "Subclass", "Subclasses")), h("dd", null, chips(ctx, subs, { max: 30 })));
    if ((ci.equivalent ?? []).length) dl.append(h("dt", null, "Equivalent to"), h("dd", null, chips(ctx, ci.equivalent!)));
    if ((ci.unionOf ?? []).length) dl.append(h("dt", null, "Union of"), h("dd", null, chips(ctx, ci.unionOf!)));
    if ((ci.disjoint ?? []).length) dl.append(h("dt", null, "Disjoint with"), h("dd", null, chips(ctx, ci.disjoint!)));
    page.appendChild(h("div", { class: "card", style: { marginBottom: "14px" } }, dl));
  }

  // Diagram.
  const tab = ctx.route.tab ?? "diagram";
  const tabs = h(
    "div",
    { class: "btn-group", style: { marginLeft: "auto" } },
    button("Diagram", () => ctx.go(e.id, { tab: "diagram" }), { icon: "diagram", cls: "small", pressed: tab === "diagram" }),
    button("Table", () => ctx.go(e.id, { tab: "table" }), { icon: "table", cls: "small", pressed: tab === "table" })
  );
  const props = ci.props ?? [];
  const own = ci.ownProps ?? props.filter((r) => r.inheritedFrom === undefined).length;
  page.appendChild(section(tab === "diagram" ? "Diagram" : "Properties", { count: tab === "diagram" ? undefined : own, tools: [tabs] }));
  if (tab === "diagram") {
    page.appendChild(diagramPanel(ctx, e.id).el);
    page.appendChild(h("p", { class: "faint", style: { fontSize: "12px", marginTop: "6px" } }, "Click a box to add its neighbours or open its own diagram (double-click adds them straight away), drag to pan, scroll to zoom. Dashed arrows point at value sets (SKOS concept schemes); dotted arrows come from other classes."));
  }

  // Property table (always below the diagram, since the diagram only shows literals inside boxes).
  const inhCount = props.length - own;
  const inhToggle = h("label", null, h("input", { type: "checkbox", checked: ctx.prefs.showInherited, onChange: (ev: Event) => {
    ctx.setPrefs({ showInherited: (ev.target as HTMLInputElement).checked });
    ctx.refresh();
  } }), `inherited (${inhCount})`);
  const hiddenCount = props.filter((r) => r.hidden).length;
  const hidToggle = hiddenCount ? h("label", null, h("input", { type: "checkbox", checked: ctx.prefs.showHidden, onChange: (ev: Event) => {
    ctx.setPrefs({ showHidden: (ev.target as HTMLInputElement).checked });
    ctx.refresh();
  } }), `hidden (${hiddenCount})`) : null;
  if (tab === "diagram") page.appendChild(section("Properties", { count: own, tools: [inhToggle, hidToggle] }));
  else page.querySelector(".section-title .tools")?.prepend(inhToggle, hidToggle ?? "");
  page.appendChild(propTable(ctx, props, { showInherited: ctx.prefs.showInherited, showHidden: ctx.prefs.showHidden }));

  // Usage.
  const usage = h("div", { class: "grid-2", style: { marginTop: "18px" } });
  if ((ci.referencedBy ?? []).length) usage.appendChild(h("div", { class: "card" }, h("h3", { style: { margin: "0 0 8px", fontSize: "14px" } }, "Pointed at by"), chips(ctx, ci.referencedBy!, { max: 24 })));
  if ((ci.inRangeOf ?? []).length) usage.appendChild(h("div", { class: "card" }, h("h3", { style: { margin: "0 0 8px", fontSize: "14px" } }, "Range of"), chips(ctx, ci.inRangeOf!, { max: 24 })));
  if ((ci.shapes ?? []).length) usage.appendChild(h("div", { class: "card" }, h("h3", { style: { margin: "0 0 8px", fontSize: "14px" } }, "Shapes"), h("p", { class: "muted", style: { margin: "0 0 6px", fontSize: "12.5px" } }, "Constraints from these shapes are merged into the table above."), chips(ctx, ci.shapes!)));
  if ((ci.instances ?? []).length) usage.appendChild(h("div", { class: "card" }, h("h3", { style: { margin: "0 0 8px", fontSize: "14px" } }, plural(ci.instances!.length, "Instance")), chips(ctx, ci.instances!, { max: 30 })));
  if (usage.childElementCount) page.append(section("Usage"), usage);

  const ann = annotations(ctx, e);
  if (ann) page.appendChild(ann);
  void link;
  return page;
}
