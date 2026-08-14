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
const battleTileSource = readFileSync(
  new URL("../src/battle/BattleTile.tsx", import.meta.url),
  "utf8",
);

test("world layout uses a sticky desktop grid and the shared compact breakpoint", () => {
  const surfaceRule = appStyles.match(/\.surface\s*\{([^}]*)\}/)?.[1] ?? "";
  const worldRule = appStyles.match(/\.worldPanel\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /display:\s*grid/);
  assert.match(surfaceRule, /grid-template-columns:/);
  assert.match(worldRule, /position:\s*sticky/);
  assert.match(appStyles, /@media \(orientation: portrait\), \(max-width: 48rem\)/);
  assert.match(appStyles, /flex-direction:\s*column/);
});

test("battle workspace has one full-width vertical layout path", () => {
  const workspaceRule = workspaceStyles.match(/\.workspace\s*\{([^}]*)\}/)?.[1] ?? "";
  const tileRule = workspaceStyles.match(/\.tile\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workspaceRule, /flex-direction:\s*column/);
  assert.match(workspaceRule, /width:\s*100%/);
  assert.match(tileRule, /width:\s*100%/);
  assert.doesNotMatch(workspaceStyles, /@media|width:\s*max-content/);
  assert.match(battleTileSource, />↑<\/button>/);
  assert.match(battleTileSource, />↓<\/button>/);
  assert.doesNotMatch(battleTileSource, />[←→]<\/button>/);
});
