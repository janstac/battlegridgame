import { createElement, Fragment, type ReactNode, type Ref } from "react";

export const COMPACT_WORLD_QUERY = "(orientation: portrait), (max-width: 48rem)";
export const WORLD_HIDDEN_ANNOUNCEMENT = "World hidden because you joined a battle.";

export type WorldLayoutMode = "compact" | "desktop";

export type WorldDisclosureState = Readonly<{
  mode: WorldLayoutMode;
  battleCount: number;
  manuallyOpen: boolean;
  autoCollapseVersion: number;
  announceAutoCollapse: boolean;
}>;

export type WorldDisclosureView = Readonly<{
  open: boolean;
  showToggle: boolean;
  toggleLabel: "Show world" | "Hide world";
}>;

type MediaQuery = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
export type MatchMedia = (query: string) => MediaQuery;

function browserMatchMedia(): MatchMedia | undefined {
  if (globalThis.matchMedia === undefined) return undefined;
  return (query) => globalThis.matchMedia(query);
}

export function getCompactWorldMode(
  matchMedia: MatchMedia | null | undefined = browserMatchMedia(),
): boolean {
  return matchMedia?.(COMPACT_WORLD_QUERY).matches ?? false;
}

export function subscribeToCompactWorldMode(
  onStoreChange: () => void,
  matchMedia: MatchMedia | null | undefined = browserMatchMedia(),
): () => void {
  if (matchMedia == null) return () => undefined;

  const query = matchMedia(COMPACT_WORLD_QUERY);
  const handleChange = () => onStoreChange();
  query.addEventListener("change", handleChange);
  return () => query.removeEventListener("change", handleChange);
}

export function createWorldDisclosureState(
  mode: WorldLayoutMode,
  battleCount = 0,
): WorldDisclosureState {
  return {
    mode,
    battleCount,
    manuallyOpen: battleCount === 0,
    autoCollapseVersion: 0,
    announceAutoCollapse: false,
  };
}

export type WorldDisclosureEvent =
  | Readonly<{ type: "sync"; mode: WorldLayoutMode; battleCount: number }>
  | Readonly<{ type: "toggle" }>;

export function reduceWorldDisclosure(
  state: WorldDisclosureState,
  event: WorldDisclosureEvent,
): WorldDisclosureState {
  if (event.type === "toggle") {
    if (state.mode !== "compact" || state.battleCount === 0) return state;
    return {
      ...state,
      manuallyOpen: !state.manuallyOpen,
      announceAutoCollapse: false,
    };
  }

  const countIncreased = event.battleCount > state.battleCount;
  const automaticallyCollapsed = event.mode === "compact"
    && event.battleCount > 0
    && countIncreased;
  const manuallyOpen = event.battleCount === 0
    ? true
    : automaticallyCollapsed
      ? false
      : state.manuallyOpen;

  return {
    mode: event.mode,
    battleCount: event.battleCount,
    manuallyOpen,
    autoCollapseVersion: state.autoCollapseVersion + (automaticallyCollapsed ? 1 : 0),
    announceAutoCollapse: automaticallyCollapsed,
  };
}

export function getWorldDisclosureView(state: WorldDisclosureState): WorldDisclosureView {
  const open = state.mode === "desktop" || state.battleCount === 0 || state.manuallyOpen;
  return {
    open,
    showToggle: state.mode === "compact" && state.battleCount > 0,
    toggleLabel: open ? "Hide world" : "Show world",
  };
}

export function WorldDisclosureRegion({
  state,
  panelId,
  panelClassName,
  toggleClassName,
  statusClassName,
  panelRef,
  toggleRef,
  onToggle,
  children,
}: Readonly<{
  state: WorldDisclosureState;
  panelId: string;
  panelClassName: string;
  toggleClassName: string;
  statusClassName: string;
  panelRef: Ref<HTMLElement>;
  toggleRef: Ref<HTMLButtonElement>;
  onToggle(): void;
  children: ReactNode;
}>) {
  const view = getWorldDisclosureView(state);
  return createElement(
    Fragment,
    null,
    view.showToggle
      ? createElement("button", {
        ref: toggleRef,
        className: toggleClassName,
        type: "button",
        "aria-expanded": view.open,
        "aria-controls": panelId,
        onClick: onToggle,
      }, view.toggleLabel)
      : null,
    createElement(
      "p",
      { className: statusClassName, "aria-live": "polite", "aria-atomic": true },
      state.announceAutoCollapse
        ? createElement("span", { key: state.autoCollapseVersion }, WORLD_HIDDEN_ANNOUNCEMENT)
        : null,
    ),
    createElement(
      "section",
      {
        ref: panelRef,
        id: panelId,
        className: panelClassName,
        hidden: !view.open,
      },
      children,
    ),
  );
}
