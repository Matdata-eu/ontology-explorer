// What every view gets: the model, navigation, and small shared UI pieces.
import type { Id, Model } from "./model";

export interface Route {
  /** "home" | "entity" | "overview" | "search" */
  view: string;
  id?: Id;
  /** Sub view of an entity page: "diagram" | "table" */
  tab?: string;
  query?: string;
  /** Extra state in the URL (depth, direction...). */
  params: Record<string, string>;
}

export interface Prefs {
  lang: string;
  theme: "light" | "dark" | "auto";
  showInherited: boolean;
  showHidden: boolean;
  depth: 1 | 2;
  direction: "DOWN" | "RIGHT";
  attributes: "all" | "focus" | "none";
  incoming: boolean;
  schemes: boolean;
}

export interface AppCtx {
  readonly m: Model;
  readonly route: Route;
  readonly prefs: Prefs;
  readonly embed: boolean;
  go(id: Id, extra?: Partial<Route>): void;
  goRoute(r: Partial<Route>): void;
  href(id: Id, extra?: Partial<Route>): string;
  hrefRoute(r: Partial<Route>): string;
  setPrefs(p: Partial<Prefs>): void;
  toast(msg: string): void;
  /** Change the current route's parameters in place (no navigation), so the link always matches the view. */
  setParams(p: Record<string, string | undefined>): void;
  /** A link to the model and the current view; `complete` is false for local files. */
  shareLink(): { url: string; complete: boolean };
  /** Re-render the current page (after a preference change). */
  refresh(): void;
}
