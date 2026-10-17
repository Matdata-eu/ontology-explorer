// Library entry: import to register <ontology-explorer>, or use the exports directly.
export { OntologyExplorerElement, define } from "./element";
export type { Bundle, Entity, Kind, PropRow } from "./model";
export { Model } from "./model";
export { loadUrl, parseFiles } from "./loader";
import { define } from "./element";
define();
