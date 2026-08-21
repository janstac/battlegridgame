import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const battleViewSource = readFileSync(
  new URL("../src/view/BattleView.tsx", import.meta.url),
  "utf8",
);
const battleViewStyles = readFileSync(
  new URL("../src/view/BattleView.module.css", import.meta.url),
  "utf8",
);
const themeStyles = readFileSync(
  new URL("../src/theme.css", import.meta.url),
  "utf8",
);

test("battle cooldowns keep stable space and expose progress only while cooling", () => {
  assert.match(battleViewSource, /className=\{styles\.cooldownSlot\}/);
  assert.match(battleViewSource, /isCooling \? styles\.cooling : ""/);
  assert.match(battleViewSource, /role=\{isCooling \? "progressbar" : undefined\}/);
  assert.match(battleViewSource, /"--cooldown-progress": ratio/);
  assert.match(battleViewSource, /\{!isCooling && \(/);
  assert.match(battleViewSource, />Ready<\/span>/);
});

test("cooldown arc geometry, color, and motion follow the style contract", () => {
  assert.match(
    battleViewStyles,
    /\.cooldownSlot \{[\s\S]*?width: 0\.78rem;[\s\S]*?height: 0\.78rem;/,
  );
  assert.match(
    battleViewStyles,
    /\.cooldownRing \{[\s\S]*?padding: 0;[\s\S]*?transition: padding 180ms ease;/,
  );
  assert.match(battleViewStyles, /\.cooling \{\s*padding: 0\.13rem;\s*\}/);
  assert.match(
    battleViewStyles,
    /var\(--color-cooldown-arc\) calc\(var\(--cooldown-progress\) \* 1turn\)/,
  );
  assert.match(
    battleViewStyles,
    /mask: radial-gradient\([\s\S]*?transparent calc\(100% - 0\.13rem\)/,
  );
  assert.match(
    battleViewStyles,
    /\.swatch \{[\s\S]*?width: 0\.52rem;[\s\S]*?height: 0\.52rem;[\s\S]*?background: var\(--player-color\);/,
  );
  assert.match(
    battleViewStyles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.cooldownRing \{\s*transition: none;/,
  );
});

test("cooldown arcs use exact contrasting theme colors", () => {
  assert.equal(
    themeStyles.match(/--color-cooldown-arc: #000;/g)?.length,
    1,
  );
  assert.equal(
    themeStyles.match(/--color-cooldown-arc: #fff;/g)?.length,
    2,
  );
});
