import assert from "node:assert/strict";
import test from "node:test";

import { SAFE_INTEGER_MAX } from "@grid-game/shared";

import { RandomBot } from "../src/RandomBot.ts";
import { BETA, createBattleSnapshot, createBotState } from "./helpers.ts";

test("maps RNG samples uniformly onto locally owned cells in row-major order", () => {
  const snapshot = createBattleSnapshot();

  assert.deepEqual(new RandomBot(() => 0).decide(createBotState(snapshot)), {
    type: "incrementCell",
    position: { x: 0, y: 0 },
  });
  assert.deepEqual(new RandomBot(() => 0.4999).decide(createBotState(snapshot)), {
    type: "incrementCell",
    position: { x: 0, y: 0 },
  });
  assert.deepEqual(new RandomBot(() => 0.5).decide(createBotState(snapshot)), {
    type: "incrementCell",
    position: { x: 0, y: 1 },
  });
  assert.deepEqual(new RandomBot(() => 0.9999).decide(createBotState(snapshot)), {
    type: "incrementCell",
    position: { x: 0, y: 1 },
  });
});

test("selects only incrementable cells belonging to the local participant", () => {
  const snapshot = createBattleSnapshot({
    cells: [
      { kind: "wall" },
      { kind: "empty" },
      { kind: "occupied", participantId: 0, count: SAFE_INTEGER_MAX },
      { kind: "occupied", participantId: BETA, count: 2 },
      { kind: "occupied", participantId: BETA, count: 3 },
      { kind: "empty" },
    ],
  });

  assert.equal(new RandomBot(() => 0).decide(createBotState(snapshot)), null);
  assert.deepEqual(new RandomBot(() => 0.99).decide(createBotState(snapshot, BETA)), {
    type: "incrementCell",
    position: { x: 1, y: 1 },
  });
});

test("bounds invalid RNG output without mutating strategy input", () => {
  const samples = [-1, Number.NaN, Number.POSITIVE_INFINITY, 1, 4];
  for (const sample of samples) {
    const snapshot = createBattleSnapshot();
    const before = structuredClone(snapshot);
    const action = new RandomBot(() => sample).decide(createBotState(snapshot));
    assert.deepEqual(snapshot, before);
    assert.deepEqual(action, sample >= 1 && Number.isFinite(sample)
      ? { type: "incrementCell", position: { x: 0, y: 1 } }
      : { type: "incrementCell", position: { x: 0, y: 0 } });
  }
});

test("returns null when no locally owned cell exists", () => {
  const snapshot = createBattleSnapshot({
    cells: Array.from({ length: 6 }, () => ({ kind: "empty" as const })),
  });
  assert.equal(new RandomBot(() => 0.5).decide(createBotState(snapshot)), null);
});
