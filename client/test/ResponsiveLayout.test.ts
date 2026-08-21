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
const pageStyles = readFileSync(
  new URL("../src/ui/GamePage.module.css", import.meta.url),
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
const worldViewportStyles = readFileSync(
  new URL("../src/world/WorldViewport.module.css", import.meta.url),
  "utf8",
);
const themeStyles = readFileSync(
  new URL("../src/theme/ThemeControl.module.css", import.meta.url),
  "utf8",
);

test("world layout reserves a sticky desktop column and uses a shared compact toolbar", () => {
  const surfaceRule = appStyles.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const worldRule = appStyles.match(/\.worldPanel\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /display:\s*grid/);
  assert.match(surfaceRule, /grid-template-columns:/);
  assert.match(worldRule, /position:\s*sticky/);
  assert.match(appStyles, /@media \(orientation: portrait\), \(max-width: 56rem\)/);
  assert.match(appStyles, /flex-direction:\s*column/);
  const toolbarRule = pageStyles.match(/\.toolbar\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(toolbarRule, /display:\s*flex/);
  assert.match(toolbarRule, /align-items:\s*center/);
  assert.match(pageStyles, /\.themeControl\s*\{\s*margin-left:\s*auto/);
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactToggleRule = compactBlock.match(/\.worldToggle\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(compactToggleRule, /display:\s*block/);
  assert.doesNotMatch(compactToggleRule, /position:\s*sticky/);
  assert.doesNotMatch(compactToggleRule, /margin-bottom/);
});

test("network page is bounded on desktop and returns to document flow when compact", () => {
  const fillRule = pageStyles.match(/\.fillViewport\s*\{([^}]*)\}/)?.[1] ?? "";
  const fillContentRule = pageStyles.match(/\.fillViewport \.content\s*\{([^}]*)\}/)?.[1] ?? "";
  const compactPage = pageStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactFillRule = compactPage.match(/\.fillViewport\s*\{([^}]*)\}/)?.[1] ?? "";
  const compactContentRule = compactPage.match(/\.fillViewport \.content\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(fillRule, /display:\s*flex/);
  assert.match(fillRule, /height:\s*100dvh/);
  assert.match(fillRule, /overflow:\s*hidden/);
  assert.match(fillContentRule, /flex:\s*1 1 0/);
  assert.match(fillContentRule, /min-height:\s*0/);
  assert.match(compactFillRule, /height:\s*auto/);
  assert.match(compactFillRule, /min-height:\s*100dvh/);
  assert.match(compactFillRule, /overflow:\s*visible/);
  assert.match(compactContentRule, /flex:\s*none/);
  assert.doesNotMatch(appStyles, /100dvh - 5\.25rem/);
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
  assert.match(workspaceRule, /grid-auto-rows:\s*calc\(\(100% - \.4rem\) \/ 2\)/);
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
  assert.match(gridAreaRule, /display:\s*flex/);
  assert.match(gridAreaRule, /align-items:\s*flex-start/);
  assert.match(gridAreaRule, /justify-content:\s*center/);
  assert.match(gridRule, /width:\s*auto/);
  assert.match(gridRule, /height:\s*100%/);
  assert.match(gridRule, /aspect-ratio:\s*1/);
  assert.match(gridRule, /max-width:\s*100%/);
  assert.match(gridRule, /max-height:\s*100%/);
});

test("battle headers stay aligned and compact in every orientation", () => {
  const headerRule = battleViewStyles.match(/\.panelHeader\s*\{([^}]*)\}/)?.[1] ?? "";
  const legendRule = battleViewStyles.match(/\.playerLegend\s*\{([^}]*)\}/)?.[1] ?? "";
  const playerRule = battleViewStyles.match(/\.player\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(headerRule, /display:\s*flex/);
  assert.match(headerRule, /align-items:\s*center/);
  assert.match(headerRule, /margin-bottom:\s*0/);
  assert.match(legendRule, /flex:\s*1 1 auto/);
  assert.match(playerRule, /font-size:\s*0\.74rem/);
  assert.match(playerRule, /line-height:\s*1\.15/);
  assert.match(battleViewStyles, /\.playerLabel\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(battleViewStyles, /\.controls\s*\{[^}]*position:\s*absolute/);
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

test("compact World disclosure does not shrink an active battle track", () => {
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const surfaceRule = compactBlock.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const trackRule = compactBlock.match(/\.battleTrack\s*\{([^}]*)\}/)?.[1] ?? "";
  const activeTrackRule = compactBlock.match(/\.activeBattleTrack\s*\{([^}]*)\}/)?.[1] ?? "";
  const worldRule = compactBlock.match(/\.worldPanel\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /--battle-track-size:\s*calc\(100dvh - 3rem\)/);
  assert.match(surfaceRule, /height:\s*auto/);
  assert.match(surfaceRule, /overflow:\s*visible/);
  assert.match(trackRule, /flex:\s*none/);
  assert.match(trackRule, /min-height:\s*0/);
  assert.match(trackRule, /overflow:\s*visible/);
  assert.match(trackRule, /overscroll-behavior:\s*auto/);
  assert.match(trackRule, /touch-action:\s*pan-y/);
  assert.match(worldRule, /flex:\s*none/);
  assert.match(activeTrackRule, /height:\s*var\(--battle-track-size\)/);
});

test("battle spacing keeps controls usable while moving the visible grid upward", () => {
  const panelRule = battleViewStyles.match(/\.panel\s*\{([^}]*)\}/)?.[1] ?? "";
  const headerRule = battleViewStyles.match(/\.panelHeader\s*\{([^}]*)\}/)?.[1] ?? "";
  const controlsRule = battleViewStyles.match(/\.controls button,\s*\.confirmationActions button\s*\{([^}]*)\}/)?.[1] ?? "";
  const workspaceRule = workspaceStyles.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(panelRule, /padding:\s*clamp\(0\.35rem, 0\.8vw, 0\.5rem\)/);
  assert.match(headerRule, /margin-bottom:\s*0/);
  assert.match(workspaceRule, /gap:\s*\.4rem/);
  assert.match(workspaceRule, /padding:\s*0/);
  assert.match(controlsRule, /min-width:\s*2rem/);
  assert.match(controlsRule, /min-height:\s*2rem/);
});

test("compact layout constrains horizontal content and compacts toolbar chrome", () => {
  const compactApp = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactPage = pageStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactTheme = themeStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactWorld = worldViewportStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const surfaceRule = appStyles.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const shellRule = worldViewportStyles.match(/\.shell\s*\{([^}]*)\}/)?.[1] ?? "";
  const toolbarRule = compactPage.match(/\.toolbar\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /max-width:\s*100%/);
  assert.match(shellRule, /max-width:\s*100%/);
  assert.match(compactApp, /--world-size:\s*min\(32rem, calc\(100vw - 1\.25rem\), 40dvh\)/);
  assert.match(toolbarRule, /gap:\s*\.35rem/);
  assert.match(compactTheme, /font-size:\s*0\.7rem/);
  assert.match(compactWorld, /width:\s*1\.85rem/);
});

test("battle gestures use document scrolling rather than a compact scroll trap", () => {
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const compactPage = pageStyles.split("@media (orientation: portrait), (max-width: 56rem)")[1] ?? "";
  const surfaceRule = compactBlock.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const trackRule = compactBlock.match(/\.battleTrack\s*\{([^}]*)\}/)?.[1] ?? "";
  const gridRule = battleGridStyles.match(/\.grid\s*\{([^}]*)\}/)?.[1] ?? "";
  const toolbarRule = compactPage.match(/\.toolbar\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /overflow:\s*visible/);
  assert.doesNotMatch(surfaceRule, /touch-action/);
  assert.match(trackRule, /overflow:\s*visible/);
  assert.match(gridRule, /touch-action:\s*pan-y/);
  assert.match(toolbarRule, /position:\s*sticky/);
  assert.match(toolbarRule, /inset-block-start:\s*0/);
});
