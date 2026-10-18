// The "About" and "Help" dialogs. The help is a short manual, one foldable section
// per feature; controls are named by their label, not by where they sit on screen.
import { h, icon, type Child } from "../dom";

const REPO = "https://github.com/Matdata-eu/ontology-explorer";

const link = (href: string, text: string) => h("a", { href, target: "_blank", rel: "noopener" }, text);
const b = (text: string) => h("strong", null, text);
const k = (text: string) => h("kbd", null, text);
const code = (text: string) => h("code", null, text);

/** A modal dialog with a title bar and a close button, added to `host`. */
function dialog(host: HTMLElement, title: string, cls: string, ...body: Child[]): HTMLDialogElement {
  const dlg = h("dialog", { class: `oe-dialog ${cls}`, "aria-label": title }) as HTMLDialogElement;
  dlg.append(
    h("div", { class: "dlg-head" }, h("h2", null, title), h("button", { type: "button", class: "btn ghost icon-only", "aria-label": "Close", title: "Close", onClick: () => dlg.close() }, icon("close"))),
    h("div", { class: "dlg-body" }, ...body)
  );
  // A click on the backdrop closes the dialog.
  dlg.addEventListener("click", (ev) => {
    if (ev.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
  host.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

export function openAbout(host: HTMLElement, opts: { licensesUrl: string; generator?: string }): void {
  const dlg = dialog(
    host,
    "About ontology-explorer",
    "about",
    h("p", null, "Ontologies, SKOS vocabularies and SHACL shapes as UML-like diagrams and readable pages. The files are read and indexed in your browser; nothing is uploaded."),
    h("p", null, "New here? Read the ", h("button", { type: "button", class: "linkish", onClick: () => {
      dlg.close();
      openHelp(host);
    } }, "short guide"), "."),
    h("h3", null, "Feedback"),
    h("p", null, "Found a bug, missing a feature or have a question? Open an issue on ", link(`${REPO}/issues`, "GitHub"), ". Source code and documentation: ", link(REPO, REPO.replace(/^https:\/\//, "")), "."),
    h("p", { class: "muted small" }, "What a model says comes from its authors and is shown as it is."),
    h("h3", null, "Credits"),
    h(
      "ul",
      { class: "credits" },
      h("li", null, "Built with ", link("https://github.com/oxigraph/oxigraph", "Oxigraph"), "'s RDF parsers in Rust and WebAssembly, and the ", link("https://eclipse.dev/elk/", "Eclipse Layout Kernel"), " for the diagrams"),
      h("li", null, "Fonts: ", link("https://github.com/jpt/barlow", "Barlow"), " and ", link("https://github.com/JetBrains/JetBrainsMono", "JetBrains Mono"), " (SIL Open Font License)"),
      h("li", null, "Example vocabularies belong to their publishers and keep their own licences"),
      h("li", null, "Full list: ", link(opts.licensesUrl, "third-party licences")),
      h("li", null, "Made by Mathias Vanden Auweele, ", link("https://matdata.eu", "MatData"), " · Apache License 2.0")
    ),
    h("p", { class: "muted small" }, `Version ${__APP_VERSION__}`, opts.generator ? ` · model indexed by ${opts.generator}` : "")
  );
}

type Part = Child;
const section = (title: string, open: boolean, ...items: Part[][]) =>
  h("details", { class: "help-sec", open: open || undefined }, h("summary", null, title), h("ul", null, ...items.map((parts) => h("li", null, ...parts))));

export function openHelp(host: HTMLElement): void {
  dialog(
    host,
    "How to use ontology-explorer",
    "help",
    h("p", { class: "muted" }, "Read an ontology, its SKOS vocabularies and SHACL shapes together, as diagrams and as one page per class, property, concept or shape. Open a topic below."),
    section(
      "Getting started",
      true,
      ["Drop Turtle, RDF/XML, JSON-LD, N-Triples, TriG or N-Quads files on the open page or ", b("choose them"), ", give the address of a file on the web, or pick one of the ", b("examples"), ". Give the ontology, its shapes and its vocabularies together: they are merged into one model."],
      ["Files are read in your browser; nothing is uploaded. A URL must allow cross-origin requests, unless the viewer runs from ", code("ontology-explorer serve --relay"), "."],
      ["The start page of a model lists its size, the classes to start from and its namespaces. ", b("Open…"), " in the top bar loads something else."]
    ),
    section(
      "Finding things",
      false,
      ["Type in the ", b("search"), " box (", k("/"), " jumps to it) to match labels, curies and IRIs. Classes and properties come first. Use ", k("↑"), " ", k("↓"), " and ", k("Enter"), " to open a result."],
      ["The tabs under the search box browse ", b("Classes"), ", ", b("Properties"), ", ", b("Vocabularies"), " and ", b("Shapes"), " as trees."],
      [b("external"), " shows classes and properties from other vocabularies that the model only refers to; ", b("deprecated"), " shows deprecated ones, struck through. Hidden entries never hide what is under them."]
    ),
    section(
      "Class pages",
      false,
      ["The top card lists super and subclasses, ancestors, equivalent and disjoint classes. Click any chip to go there."],
      [b("Diagram"), " draws the class with its neighbours; ", b("Table"), " shows only the property table."],
      ["The property table has one row per property: the ", b("expected value"), " (a class, a datatype or a value set), the ", b("cardinality"), ", the ", b("constraints"), " and where each fact comes from (", b("ontology"), " domain and range, OWL restrictions, or SHACL ", b("shape"), ")."],
      [b("inherited"), " adds the rows of the super classes, ", b("hidden"), " the rows marked ", code("dash:hidden"), "."],
      [b("Usage"), " lists the properties that point at the class, the shapes that apply to it and its instances."]
    ),
    section(
      "Diagrams",
      false,
      ["Click a box to ", b("add its neighbours"), " to the diagram or to open its own diagram or table. Double-click adds the neighbours straight away. Drag to pan, scroll or pinch to zoom."],
      [b("Depth"), " shows one or two steps around the class. The attributes list chooses which boxes list their literal properties; links to other classes are always arrows. ", b("Inherited"), ", ", b("Incoming"), ", ", b("Subclasses"), " and ", b("Value sets"), " add more to the picture."],
      ["Notation: a hollow triangle is ", b("is a"), " (subclass of), an arrow is ", b("has"), " with its multiplicity, a diamond is ", b("contains"), " (", code("dash:composite"), "). Dashed arrows point at value sets (concept schemes), dotted arrows come from other classes. The class you are on has the amber outline."],
      ["The tree button flips the layout, ", b("Full screen"), " gives the diagram the whole screen (", k("Esc"), " to leave), and ", b("Export"), " saves SVG or PNG, or copies PlantUML or Mermaid."],
      ["Properties and shapes have a diagram too: a property between its domain and range classes, a shape with its property shapes and the classes and shapes it points at."]
    ),
    section(
      "Properties, vocabularies and shapes",
      false,
      ["A ", b("property"), " page shows its domain and range, super and sub-properties, and every class and shape that uses it."],
      ["A ", b("concept scheme"), " is a value set: its page shows the concepts as a tree with notations, and the properties that use it. A ", b("concept"), " page shows broader, narrower and related concepts and mappings."],
      ["A ", b("shape"), " page shows its targets, its property shapes with their constraints, node constraints and SPARQL constraints. Shapes are also merged into the class tables by path."],
      [b("RDF"), " on any page shows the triples about the entity, in Turtle, as they were in the files. Copy it with the button next to it."]
    ),
    section(
      "Overview map",
      false,
      [b("Overview map"), " on the start page draws every class, grouped by hierarchy. ", b("Associations"), " also draws the links between classes, ", b("External"), " adds classes from other vocabularies, and the namespace list narrows the map to one namespace."],
      ["Very large models show the most connected classes first."]
    ),
    section(
      "Sharing and display",
      false,
      [b("Share"), " copies a link to exactly this view: the model, the page, the tab, the diagram's options, the boxes you added and the zoom. The address bar always holds the same link."],
      ["A link works for anyone who can open the same model: a URL, an example or the same server. Files you opened from your computer are not part of the link."],
      ["The language list chooses the language of labels and descriptions; the moon and sun button switches between light and dark."],
      ["Links to a page also work by hand: ", code("#/e/<IRI>"), " or ", code("#/e/<curie>"), ", with ", code("?src=<url>"), " to load a model first."]
    ),
    section(
      "DASH and SHACL details",
      false,
      [code("sh:group"), " and ", code("sh:order"), " group and order the table rows and diagram attributes. ", code("dash:propertyRole"), " marks labels and identifiers, ", code("dash:abstract"), " shows a class name in italics, ", code("dash:composite"), " draws a diamond, ", code("dash:hidden"), " hides rows, ", code("dash:readOnly"), " marks them."],
      ["Without DASH, rows follow the ontology's order and every property is shown."],
      ["Value sets are recognised from a range that is a concept scheme, from ", code("sh:in"), " lists of one scheme's concepts, and from ", code("sh:node"), " shapes that pin ", code("skos:inScheme"), "."]
    )
  );
}
