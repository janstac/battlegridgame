import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tileSource = readFileSync(
  new URL("../src/battle/BattleTile.tsx", import.meta.url),
  "utf8",
);
const viewSource = readFileSync(
  new URL("../src/view/BattleView.tsx", import.meta.url),
  "utf8",
);
const workspaceStyles = readFileSync(
  new URL("../src/battle/BattleWorkspace.module.css", import.meta.url),
  "utf8",
);
const viewStyles = readFileSync(
  new URL("../src/view/BattleView.module.css", import.meta.url),
  "utf8",
);

test("battle controls are rendered by the inner panel and moves appear above two battles", () => {
  assert.doesNotMatch(tileSource, /tileActions|>Leave<|>↑<|>↓</);
  assert.match(tileSource, /showMoveButtons:\s*count > 2/);
  assert.match(viewSource, /controls\.showMoveButtons/);
  assert.match(viewSource, /aria-label={`Leave \$\{controls\.battleLabel\}`}/);
  assert.match(viewSource, />\s*×\s*<\/button>/);
  assert.doesNotMatch(workspaceStyles, /\.tileActions|\.leave/);
});

test("leaving requires an in-panel accessible confirmation", () => {
  assert.match(viewSource, /setConfirmingLeave\(true\)/);
  assert.match(viewSource, /controls !== undefined && confirmingLeave/);
  assert.match(viewSource, /role="dialog"/);
  assert.doesNotMatch(viewSource, /aria-modal/);
  assert.match(viewSource, /aria-labelledby=\{confirmationTitleId\}/);
  assert.match(viewSource, /aria-describedby=\{confirmationDescriptionId\}/);
  assert.match(viewSource, /handleConfirmationKeyDown/);
  assert.match(viewSource, /document\.addEventListener\("focusin", keepFocusInDialog\)/);
  assert.match(viewSource, /leaveButtonRef\.current\?\.focus\(\)/);
});

test("confirmation overlay is centered and scoped to the battle panel", () => {
  const panelRule = viewStyles.match(/\.panel\s*\{([^}]*)\}/)?.[1] ?? "";
  const overlayRule = viewStyles.match(/\.confirmationLayer\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(panelRule, /position:\s*relative/);
  assert.match(panelRule, /overflow:\s*hidden/);
  assert.match(overlayRule, /position:\s*absolute/);
  assert.match(overlayRule, /inset:\s*0/);
  assert.match(overlayRule, /place-items:\s*center/);
  assert.match(overlayRule, /background:\s*rgb\(0 0 0 \/ 65%\)/);
});
