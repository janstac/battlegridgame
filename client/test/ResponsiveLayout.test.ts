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

test("battle workspace flows bounded desktop tiles in rows of two", () => {
  const workspaceRule = workspaceStyles.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  const tileRule = workspaceStyles.match(/\.tile\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workspaceRule, /display:\s*grid/);
  assert.match(workspaceRule, /grid-template-columns:\s*repeat\(2,/);
  assert.match(workspaceRule, /width:\s*max-content/);
  assert.match(workspaceRule, /max-width:\s*100%/);
  assert.match(tileRule, /width:\s*var\(--battle-tile-size\)/);
});

test("compact battle workspace returns to one viewport-aware column", () => {
  assert.match(workspaceStyles, /@media \(orientation: portrait\), \(max-width: 56rem\)/);
  const compactBlock = workspaceStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const workspaceRule = compactBlock.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workspaceRule, /grid-template-columns:\s*minmax\(0, var\(--battle-tile-size\)\)/);
  assert.match(workspaceRule, /--battle-tile-size:\s*min\(100%, 28rem, calc\(\(100dvh - 13\.5rem\) \/ 2\)\)/);
  assert.match(workspaceRule, /width:\s*100%/);
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

test("compact height budget fits two square grids plus complete panel chrome", () => {
  const rem = 16;
  const reservedChrome = 13.5 * rem;
  const viewports: readonly (readonly [number, number])[] = [
    [844, 390],
    [600, 800],
    [768, 1024],
  ];
  for (const [width, height] of viewports) {
    const gridSize = Math.min(width, 28 * rem, (height - reservedChrome) / 2);
    assert.ok(gridSize > 0);
    assert.ok(gridSize * 2 + reservedChrome <= height);
  }
});
