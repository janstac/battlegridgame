import assert from "node:assert/strict";
import test from "node:test";

import { cooldownProgress } from "../src/view/cooldownProgress.ts";

test("cooldown progress is exact for a reconnect snapshot", () => {
  assert.deepEqual(cooldownProgress({
    participantId: 0,
    nextActionTick: 18,
    durationTicks: 10,
  }, 13), {
    remainingTicks: 5,
    ratio: 0.5,
  });
});

test("ready and zero-duration cooldowns have no fill", () => {
  assert.deepEqual(cooldownProgress(undefined, 20), {
    remainingTicks: 0,
    ratio: 0,
  });
  assert.deepEqual(cooldownProgress({
    participantId: 0,
    nextActionTick: 20,
    durationTicks: 0,
  }, 20), {
    remainingTicks: 0,
    ratio: 0,
  });
});
