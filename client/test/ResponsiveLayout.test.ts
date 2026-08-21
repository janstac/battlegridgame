import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMPACT_WORLD_QUERY,
  getCompactWorldMode,
  type MatchMedia,
} from "../src/app/worldDisclosure.ts";

const appStyles = readFileSync(
  new URL("../src/app/NetworkGame.module.css", import.meta.url),
  "utf8",
);
const workspaceStyles = readFileSync(
  new URL("../src/battle/BattleWorkspace.module.css", import.meta.url),
  "utf8",
);
const battleViewStyles = readFileSync(
  new URL("../src/view/BattleView.module.css", import.meta.url),
  "utf8",
);
const battleGridStyles = readFileSync(
  new URL("../src/view/BattleGridView.module.css", import.meta.url),
  "utf8",
);

test("world layout reserves a sticky desktop column and elevates compact disclosure", () => {
  const surfaceRule = appStyles.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const worldRule = appStyles.match(/\.worldPanel\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /display:\s*grid/);
  assert.match(surfaceRule, /grid-template-columns:/);
  assert.match(worldRule, /position:\s*sticky/);
  assert.match(appStyles, /@media \(orientation: portrait\), \(max-width: 56rem\)/);
  assert.match(appStyles, /flex-direction:\s*column/);
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactToggleRule = compactBlock.match(/\.worldToggle\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(compactToggleRule, /position:\s*sticky/);
  assert.match(compactToggleRule, /top:\s*\.25rem/);
});

test("battle workspace fills the desktop track with rows of two", () => {
  const trackRule = appStyles.match(/\.battleTrack\s*\{([^}]*)\}/)?.[1] ?? "";
  const workspaceRule = workspaceStyles.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  const tileRule = workspaceStyles.match(/\.tile\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(trackRule, /height:\s*100%/);
  assert.match(trackRule, /overflow:\s*auto/);
  assert.match(workspaceRule, /display:\s*grid/);
  assert.match(workspaceRule, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(workspaceRule, /grid-auto-rows:\s*100%/);
  assert.match(workspaceRule, /width:\s*100%/);
  assert.match(workspaceRule, /height:\s*100%/);
  assert.match(tileRule, /min-width:\s*0/);
  assert.match(tileRule, /min-height:\s*0/);
});

test("compact battle workspace fits two full-width panels in the track", () => {
  assert.match(workspaceStyles, /@media \(orientation: portrait\), \(max-width: 56rem\)/);
  const compactBlock = workspaceStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const workspaceRule = compactBlock.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workspaceRule, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(workspaceRule, /grid-auto-rows:\s*calc\(\(100% - \.75rem\) \/ 2\)/);
  assert.doesNotMatch(workspaceStyles, /--battle-tile-size/);
});

test("battle panels give all remaining width and height to the square grid", () => {
  const panelRule = battleViewStyles.match(/\.panel\s*\{([^}]*)\}/)?.[1] ?? "";
  const gridAreaRule = battleViewStyles.match(/\.gridArea\s*\{([^}]*)\}/)?.[1] ?? "";
  const gridRule = battleGridStyles.match(/\.grid\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(panelRule, /display:\s*flex/);
  assert.match(panelRule, /height:\s*100%/);
  assert.match(gridAreaRule, /flex:\s*1 1 0/);
  assert.match(gridAreaRule, /min-height:\s*0/);
  assert.match(gridAreaRule, /place-items:\s*center/);
  assert.match(gridRule, /width:\s*100%/);
  assert.match(gridRule, /height:\s*100%/);
  assert.match(gridRule, /max-width:\s*100%/);
  assert.match(gridRule, /max-height:\s*100%/);
});

function viewportMatchMedia(width: number, height: number): MatchMedia {
  return (query) => ({
    matches: query === COMPACT_WORLD_QUERY && (height > width || width <= 56 * 16),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

test("representative phone and desktop viewports select the intended layout mode", () => {
  assert.equal(getCompactWorldMode(viewportMatchMedia(844, 390)), true);
  assert.equal(getCompactWorldMode(viewportMatchMedia(600, 800)), true);
  assert.equal(getCompactWorldMode(viewportMatchMedia(768, 1024)), true);
  assert.equal(getCompactWorldMode(viewportMatchMedia(1073, 632)), false);
});

test("compact surface gives its remaining viewport height to the battle track", () => {
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const surfaceRule = compactBlock.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const trackRule = compactBlock.match(/\.battleTrack\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /height:\s*calc\(100dvh - 5\.25rem\)/);
  assert.match(trackRule, /flex:\s*1 1 0/);
  assert.match(trackRule, /min-height:\s*0/);
  assert.match(trackRule, /overflow:\s*auto/);
});
