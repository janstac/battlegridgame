import assert from "node:assert/strict";
import test from "node:test";

import { BattleState } from "../src/domain/index.ts";
import { ALPHA, BETA, makeGrid, makeSetup, occupied } from "./helpers.ts";

test("BattleState exposes safe copies and mechanical mutation methods", () => {
  const state = BattleState.create(
    makeSetup(makeGrid(2, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 1)],
    ])),
    { ticksPerSecond: 20, splitDelayTicks: 10 },
  );
  const cell = state.cellAt({ x: 0, y: 0 });
  if (cell.kind === "occupied") cell.count = 99;
  assert.deepEqual(state.cellAt({ x: 0, y: 0 }), occupied(ALPHA, 1));

  state.replaceCell({ x: 0, y: 0 }, occupied(ALPHA, 5));
  state.replaceCooldown({ participantId: ALPHA, nextActionTick: 4, durationTicks: 4, acceptedActionCount: 1 });
  state.addPendingSplit({
    position: { x: 0, y: 0 }, dueTick: 10, sequence: 0,
  });
  assert.deepEqual(state.cellAt({ x: 0, y: 0 }), occupied(ALPHA, 5));
  assert.equal(state.cooldownFor(ALPHA)?.nextActionTick, 4);
  assert.equal(state.cooldownFor(ALPHA)?.durationTicks, 4);
  assert.equal(state.pendingSplits().length, 1);
});
