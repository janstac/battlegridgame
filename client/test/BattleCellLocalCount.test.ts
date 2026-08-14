import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cellSource = await readFile(
  new URL("../src/view/BattleCellView.tsx", import.meta.url),
  "utf8",
);
const cellStyles = await readFile(
  new URL("../src/view/BattleCellView.module.css", import.meta.url),
  "utf8",
);
const themeStyles = await readFile(
  new URL("../src/theme.css", import.meta.url),
  "utf8",
);

function ruleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing ${selector} rule`);
  return match[1] ?? "";
}

test("local and non-local counts keep conditional label styling", () => {
  assert.match(
    cellSource,
    /isLocallyOwned\s*\?\s*styles\.localCount\s*:\s*""/,
  );
  assert.equal(cellSource.match(/styles\.localCount/g)?.length, 1);
});

test("local count outline has the doubled purpose-specific stroke", () => {
  const localCount = ruleBody(cellStyles, ".localCount");

  assert.match(localCount, /paint-order:\s*stroke fill;/);
  assert.match(localCount, /stroke:\s*var\(--color-local-count-outline\);/);
  assert.match(localCount, /stroke-linejoin:\s*round;/);
  assert.match(localCount, /stroke-width:\s*0\.09px;/);
  assert.doesNotMatch(localCount, /--color-surface-raised/);
  assert.doesNotMatch(localCount, /0\.045px/);
});

test("local count outline contrasts in light and both dark theme modes", () => {
  const lightTheme = ruleBody(
    themeStyles,
    ':root,\n:root[data-theme="light"]',
  );
  const systemDarkTheme = ruleBody(themeStyles, ":root:not([data-theme])");
  const explicitDarkTheme = ruleBody(themeStyles, ':root[data-theme="dark"]');

  assert.match(lightTheme, /--color-local-count-outline:\s*#000;/);
  assert.match(systemDarkTheme, /--color-local-count-outline:\s*#fff;/);
  assert.match(explicitDarkTheme, /--color-local-count-outline:\s*#fff;/);
  assert.equal(
    themeStyles.match(/--color-local-count-outline:/g)?.length,
    3,
  );
});
