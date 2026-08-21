import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(appStyles, /@media \(orientation: portrait\), \(max-width: 48rem\)/);
  assert.match(appStyles, /flex-direction:\s*column/);
  const compactBlock = appStyles.split("@media (orientation: portrait), (max-width: 48rem)")[1] ?? "";
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
  assert.match(workspaceStyles, /@media \(orientation: portrait\), \(max-width: 48rem\)/);
  const compactBlock = workspaceStyles.split("@media (orientation: portrait), (max-width: 48rem)")[1] ?? "";
  const workspaceRule = compactBlock.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workspaceRule, /grid-template-columns:\s*minmax\(0, var\(--battle-tile-size\)\)/);
  assert.match(workspaceRule, /--battle-tile-size:\s*min\(100%, 28rem, calc\(\(100dvh - 16rem\) \/ 2\)\)/);
  assert.match(workspaceRule, /width:\s*100%/);
});
