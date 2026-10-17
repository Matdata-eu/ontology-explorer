// The left panel: search, and trees of classes, properties, vocabularies and shapes.
import type { AppCtx } from "../ctx";
import { debounce, h, icon, plural } from "../dom";
import { KIND_LABEL, type Id, type Kind } from "../model";
import { nav } from "./common";

type Tab = "classes" | "properties" | "vocabularies" | "shapes";

export interface Sidebar {
  el: HTMLElement;
  /** Highlight the selected entity and reveal it in the tree. */
  select(id: Id | undefined): void;
  focusSearch(): void;
}

export function sidebar(ctx: AppCtx): Sidebar {
  const m = ctx.m;
  const st = m.b.stats;
  const el = h("div", { class: "sidebar" });
  const input = h("input", { class: "input", type: "search", placeholder: "Search classes, properties, concepts…", "aria-label": "Search", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const kbd = h("kbd", null, "/");
  const box = h("div", { class: "search-box" }, icon("search"), input, kbd);
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const tree = h("div", { class: "tree" });
  el.append(box, tabs, tree);

  let tab: Tab = st.classes ? "classes" : st.conceptSchemes ? "vocabularies" : st.nodeShapes ? "shapes" : "properties";
  try {
    const saved = localStorage.getItem("oe.tab") as Tab | null;
    if (saved && ["classes", "properties", "vocabularies", "shapes"].includes(saved)) tab = saved;
  } catch {
    /* no storage */
  }
  const tabDefs: { id: Tab; label: string; count: number }[] = [
    { id: "classes", label: "Classes", count: st.classes },
    { id: "properties", label: "Properties", count: st.objectProperties + st.datatypeProperties + st.otherProperties },
    { id: "vocabularies", label: "Vocabularies", count: st.conceptSchemes },
    { id: "shapes", label: "Shapes", count: st.nodeShapes },
  ];
  for (const t of tabDefs) {
    if (t.count === 0) continue;
    const b = h("button", { type: "button", role: "tab", "aria-selected": String(t.id === tab), onClick: () => {
      tab = t.id;
      try {
        localStorage.setItem("oe.tab", tab);
      } catch {
        /* ignore */
      }
      tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      renderTree();
    } }, t.label, h("span", { class: "count" }, t.count.toLocaleString()));
    tabs.appendChild(b);
  }

  let selected: Id | undefined;
  let showExternal = false;
  let showDeprecated = true;

  // ---- trees -------------------------------------------------------------
  const rowEl = (id: Id, children: () => Id[], count?: number): HTMLElement => {
    const e = m.entity(id);
    const kids = children();
    const li = h("li", { class: "tnode", dataset: { id: String(id) } });
    let open = false;
    let ul: HTMLElement | null = null;
    const twisty = h("button", { class: `twisty${kids.length ? "" : " leaf"}`, type: "button", "aria-label": "expand", onClick: (ev: Event) => {
      ev.stopPropagation();
      toggle();
    } }, icon("chevron"));
    const toggle = (force?: boolean) => {
      open = force ?? !open;
      twisty.classList.toggle("open", open);
      if (open && !ul) {
        ul = h("ul", null, kids.slice(0, 400).map((k) => rowEl(k, () => childrenOf(k))));
        if (kids.length > 400) ul.appendChild(h("li", { class: "faint", style: { padding: "4px 8px" } }, `+${kids.length - 400} more (use search)`));
        li.appendChild(ul);
      } else if (ul) ul.hidden = !open;
    };
    const row = h(
      "a",
      { class: `row${id === selected ? " selected" : ""}${e.deprecated ? " deprecated" : ""}${m.isExternal(id) ? " external" : ""}`, href: ctx.href(id), title: e.curie, onClick: nav(ctx, id) },
      twisty,
      h("span", { class: `kind-dot k-${e.kind}` }),
      h("span", { class: "lbl" }, m.label(id)),
      count !== undefined && count > 0 ? h("span", { class: "count" }, count.toLocaleString()) : kids.length ? h("span", { class: "count" }, kids.length) : null
    );
    li.appendChild(row);
    (li as HTMLElement & { _toggle?: (f?: boolean) => void })._toggle = toggle;
    return li;
  };
  const visible = (id: Id) => (showExternal || !m.isExternal(id)) && (showDeprecated || !m.entity(id).deprecated);
  const childrenOf = (id: Id): Id[] => {
    const e = m.entity(id);
    if (e.kind === "class") return (m.cls(id)?.subClasses ?? []).filter(visible);
    if (e.kind === "conceptScheme") return m.scheme(id)?.topConcepts ?? [];
    if (e.kind === "concept") return m.concept(id)?.narrower ?? [];
    if (e.kind === "objectProperty" || e.kind === "datatypeProperty" || e.kind === "property" || e.kind === "annotationProperty") return (m.prop(id)?.subProperties ?? []).filter(visible);
    return [];
  };
  const toolbar = (...extra: Node[]) =>
    h(
      "div",
      { class: "toolbar" },
      h("label", null, h("input", { type: "checkbox", checked: showExternal, onChange: (ev: Event) => {
        showExternal = (ev.target as HTMLInputElement).checked;
        renderTree();
      } }), "external"),
      h("label", null, h("input", { type: "checkbox", checked: showDeprecated, onChange: (ev: Event) => {
        showDeprecated = (ev.target as HTMLInputElement).checked;
        renderTree();
      } }), "deprecated"),
      ...extra
    );
  const sorted = (ids: Id[]) => [...ids].sort((a, b) => m.label(a).localeCompare(m.label(b), undefined, { numeric: true }));

  const renderTree = () => {
    tree.replaceChildren();
    if (input.value.trim()) {
      renderResults();
      return;
    }
    if (tab === "classes") {
      tree.appendChild(toolbar());
      const roots = m.b.rootClasses.filter(visible);
      const ul = h("ul", { class: "tnode" }, roots.map((r) => rowEl(r, () => childrenOf(r))));
      tree.appendChild(ul);
      if (roots.length === 0) tree.appendChild(h("div", { class: "empty" }, "No classes to show."));
    } else if (tab === "properties") {
      tree.appendChild(toolbar());
      const groups: [Kind, string][] = [
        ["objectProperty", "Object properties (links)"],
        ["datatypeProperty", "Datatype properties (values)"],
        ["property", "Other properties"],
        ["annotationProperty", "Annotation properties"],
      ];
      for (const [kind, title] of groups) {
        const ids = m.b.entities.filter((e) => e.kind === kind && visible(e.id) && (kind !== "annotationProperty" || !m.isExternal(e.id))).map((e) => e.id);
        if (ids.length === 0) continue;
        // Top level: properties without a super property in the list.
        const set = new Set(ids);
        const top = sorted(ids.filter((id) => !(m.prop(id)?.superProperties ?? []).some((s) => set.has(s))));
        tree.appendChild(h("div", { class: "section" }, `${title} · ${ids.length}`));
        tree.appendChild(h("ul", { class: "tnode" }, top.map((id) => rowEl(id, () => childrenOf(id)))));
      }
    } else if (tab === "vocabularies") {
      const schemes = sorted(Object.keys(m.b.schemes).map(Number));
      tree.appendChild(h("ul", { class: "tnode" }, schemes.map((sid) => rowEl(sid, () => childrenOf(sid), m.scheme(sid)?.concepts?.length))));
    } else if (tab === "shapes") {
      const shapes = sorted(Object.keys(m.b.shapes).map(Number));
      tree.appendChild(h("ul", { class: "tnode" }, shapes.map((sid) => rowEl(sid, () => []))));
    }
  };

  // ---- search ------------------------------------------------------------
  let active = -1;
  let hits: Id[] = [];
  const renderResults = () => {
    const q = input.value.trim();
    tree.replaceChildren();
    if (!q) return renderTree();
    hits = m.search(q, { limit: 80 });
    const list = h("div", { class: "results" });
    if (hits.length === 0) list.appendChild(h("div", { class: "empty" }, "Nothing matches."));
    hits.forEach((id, i) => {
      const e = m.entity(id);
      const ctxText = e.kind === "concept" ? (m.concept(id)?.schemes ?? []).map((s) => m.label(s)).join(", ") : KIND_LABEL[e.kind];
      list.appendChild(
        h("a", { class: `hit${i === active ? " active" : ""}${e.deprecated ? " deprecated" : ""}`, href: ctx.href(id), onClick: nav(ctx, id), title: e.curie }, h("span", { class: `kind-dot k-${e.kind}` }), h("span", { class: "lbl" }, m.label(id)), h("span", { class: "ctx" }, ctxText))
      );
    });
    tree.appendChild(list);
    const total = m.b.entities.length;
    tree.appendChild(h("div", { class: "faint", style: { padding: "6px 10px", fontSize: "12px" } }, hits.length >= 80 ? `First 80 of many matches in ${plural(total, "entity", "entities")}` : `${hits.length} of ${plural(total, "entity", "entities")}`));
  };
  input.addEventListener("input", debounce(() => {
    active = -1;
    renderResults();
    kbd.hidden = input.value.length > 0;
  }, 80));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!hits.length) return;
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      tree.querySelectorAll(".hit").forEach((x, i) => x.classList.toggle("active", i === active));
      tree.querySelectorAll(".hit")[active]?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") {
      const id = hits[active >= 0 ? active : 0];
      if (id !== undefined) ctx.go(id);
    } else if (ev.key === "Escape") {
      input.value = "";
      renderTree();
      input.blur();
    }
  });

  renderTree();

  const reveal = (id: Id) => {
    // Open ancestors in the class tree so the selected class is visible.
    const e = m.entity(id);
    if (tab === "classes" && e.kind === "class") {
      const chain: Id[] = [];
      let cur: Id | undefined = id;
      const seen = new Set<Id>();
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        chain.unshift(cur);
        cur = (m.cls(cur)?.superClasses ?? [])[0];
      }
      let scope: ParentNode = tree;
      for (const c of chain) {
        const li = scope.querySelector<HTMLElement & { _toggle?: (f?: boolean) => void }>(`:scope > ul > li[data-id="${c}"], :scope > li[data-id="${c}"]`);
        if (!li) break;
        if (c !== id) li._toggle?.(true);
        scope = li;
      }
    }
    const row = tree.querySelector<HTMLElement>(`li[data-id="${id}"] > .row`);
    row?.scrollIntoView({ block: "nearest" });
  };

  return {
    el,
    select(id) {
      selected = id;
      tree.querySelectorAll(".row.selected").forEach((r) => r.classList.remove("selected"));
      if (id === undefined) return;
      if (!input.value.trim()) {
        const kind = m.entity(id).kind;
        const want: Tab | null = kind === "class" ? "classes" : kind === "concept" || kind === "conceptScheme" ? "vocabularies" : kind === "nodeShape" ? "shapes" : kind.endsWith("Property") || kind === "property" ? "properties" : null;
        if (want && want !== tab && tabDefs.find((t) => t.id === want)?.count) {
          tab = want;
          tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x.textContent?.startsWith(tabDefs.find((t) => t.id === want)!.label) ?? false)));
          renderTree();
        }
        reveal(id);
      }
      tree.querySelectorAll<HTMLElement>(`li[data-id="${id}"] > .row`).forEach((r) => r.classList.add("selected"));
    },
    focusSearch() {
      input.focus();
      input.select();
    },
  };
}
