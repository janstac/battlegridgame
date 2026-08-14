import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COMPACT_WORLD_QUERY,
  createWorldDisclosureState,
  getCompactWorldMode,
  getWorldDisclosureView,
  reduceWorldDisclosure,
  subscribeToCompactWorldMode,
  WorldDisclosureRegion,
  type MatchMedia,
  type WorldDisclosureState,
} from "../src/app/worldDisclosure.ts";

function sync(
  state: WorldDisclosureState,
  mode: "compact" | "desktop",
  battleCount: number,
) {
  return reduceWorldDisclosure(state, { type: "sync", mode, battleCount });
}

test("compact disclosure is forced open without battles and hides its toggle", () => {
  const state = createWorldDisclosureState("compact");
  assert.deepEqual(getWorldDisclosureView(state), {
    open: true,
    showToggle: false,
    toggleLabel: "Hide world",
  });
  assert.strictEqual(reduceWorldDisclosure(state, { type: "toggle" }), state);
});

test("every compact battle-count increase automatically closes the world", () => {
  let state = sync(createWorldDisclosureState("compact"), "compact", 1);
  assert.deepEqual(getWorldDisclosureView(state), {
    open: false,
    showToggle: true,
    toggleLabel: "Show world",
  });
  assert.equal(state.autoCollapseVersion, 1);
  assert.equal(state.announceAutoCollapse, true);

  state = reduceWorldDisclosure(state, { type: "toggle" });
  assert.equal(getWorldDisclosureView(state).open, true);
  assert.equal(state.announceAutoCollapse, false);

  state = sync(state, "compact", 2);
  assert.equal(getWorldDisclosureView(state).open, false);
  assert.equal(state.autoCollapseVersion, 2);
});

test("decreases preserve a manual choice until zero battles forces the world open", () => {
  let state = sync(createWorldDisclosureState("compact"), "compact", 2);
  state = reduceWorldDisclosure(state, { type: "toggle" });
  state = sync(state, "compact", 1);
  assert.equal(getWorldDisclosureView(state).open, true);

  state = reduceWorldDisclosure(state, { type: "toggle" });
  state = sync(state, "compact", 0);
  assert.deepEqual(getWorldDisclosureView(state), {
    open: true,
    showToggle: false,
    toggleLabel: "Hide world",
  });
});

test("desktop forces visibility while preserving valid compact disclosure state", () => {
  let state = sync(createWorldDisclosureState("compact"), "compact", 1);
  assert.equal(getWorldDisclosureView(state).open, false);

  state = sync(state, "desktop", 1);
  assert.deepEqual(getWorldDisclosureView(state), {
    open: true,
    showToggle: false,
    toggleLabel: "Hide world",
  });
  assert.strictEqual(reduceWorldDisclosure(state, { type: "toggle" }), state);
  assert.equal(state.announceAutoCollapse, false);

  state = sync(state, "compact", 1);
  assert.equal(getWorldDisclosureView(state).open, false);
});

test("battle increases on desktop do not create compact auto-collapse announcements", () => {
  const state = sync(createWorldDisclosureState("desktop"), "desktop", 1);
  assert.equal(state.autoCollapseVersion, 0);
  assert.equal(getWorldDisclosureView(state).open, true);
});

test("compact media detection uses the shared query and cleans up its listener", () => {
  let receivedQuery = "";
  let listener: EventListenerOrEventListenerObject | null = null;
  let removed: EventListenerOrEventListenerObject | null = null;
  let notifications = 0;
  const matchMedia = ((query: string) => {
    receivedQuery = query;
    return {
      matches: true,
      addEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
        listener = next;
      },
      removeEventListener: (_type: string, next: EventListenerOrEventListenerObject) => {
        removed = next;
      },
    };
  }) as MatchMedia;

  assert.equal(getCompactWorldMode(matchMedia), true);
  const unsubscribe = subscribeToCompactWorldMode(() => notifications += 1, matchMedia);
  assert.equal(receivedQuery, COMPACT_WORLD_QUERY);
  assert.notEqual(listener, null);
  (listener as unknown as EventListener)(new Event("change"));
  assert.equal(notifications, 1);

  unsubscribe();
  assert.strictEqual(removed, listener);
});

test("compact media detection falls back to desktop without matchMedia", () => {
  assert.equal(getCompactWorldMode(null), false);
  assert.doesNotThrow(() => subscribeToCompactWorldMode(() => undefined, null)());
});

function renderRegion(state: WorldDisclosureState): string {
  return renderToStaticMarkup(createElement(WorldDisclosureRegion, {
    state,
    panelId: "world-panel-test",
    panelClassName: "panel",
    toggleClassName: "toggle",
    statusClassName: "status",
    panelRef: null,
    toggleRef: null,
    onToggle: () => undefined,
    children: createElement("span", null, "Persistent world"),
  }));
}

test("compact disclosure markup connects the toggle to a mounted hidden world", () => {
  const markup = renderRegion(sync(createWorldDisclosureState("compact"), "compact", 1));
  assert.match(markup, /<button[^>]*aria-expanded="false"[^>]*aria-controls="world-panel-test"[^>]*>Show world<\/button>/);
  assert.match(markup, /<p[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*><span>World hidden because you joined a battle\.<\/span><\/p>/);
  assert.match(markup, /<section[^>]*id="world-panel-test"[^>]*hidden=""[^>]*><span>Persistent world<\/span><\/section>/);
});

test("manual reopen markup exposes Hide world and keeps the same panel mounted", () => {
  const collapsed = sync(createWorldDisclosureState("compact"), "compact", 1);
  const markup = renderRegion(reduceWorldDisclosure(collapsed, { type: "toggle" }));
  assert.match(markup, /<button[^>]*aria-expanded="true"[^>]*>Hide world<\/button>/);
  assert.doesNotMatch(markup, /<section[^>]*hidden=""/);
  assert.match(markup, /<section[^>]*><span>Persistent world<\/span><\/section>/);
});

test("zero-battle and desktop markup omit the disclosure toggle and show the world", () => {
  const compactMarkup = renderRegion(createWorldDisclosureState("compact"));
  assert.doesNotMatch(compactMarkup, /<button/);
  assert.doesNotMatch(compactMarkup, / hidden=""/);
  assert.match(compactMarkup, /<span>Persistent world<\/span>/);

  const desktopMarkup = renderRegion(sync(createWorldDisclosureState("desktop"), "desktop", 2));
  assert.doesNotMatch(desktopMarkup, /<button/);
  assert.doesNotMatch(desktopMarkup, / hidden=""/);
});
