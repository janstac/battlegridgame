import assert from "node:assert/strict";
import test from "node:test";

import { WaitingChallengeQueue } from "../src/world/WaitingChallengeQueue.ts";

test("allocates stable monotonic IDs and never reuses removed IDs", () => {
  const queue = new WaitingChallengeQueue();
  assert.equal(queue.enqueue("challenge-a"), 1);
  assert.equal(queue.enqueue("challenge-b"), 2);
  assert.equal(queue.enqueue("challenge-a"), 1);
  assert.equal(queue.remove("challenge-a"), true);
  assert.equal(queue.enqueue("challenge-c"), 3);
  assert.deepEqual(queue.entriesInOrder(), [
    { challengeId: "challenge-b", waitingId: 2 },
    { challengeId: "challenge-c", waitingId: 3 },
  ]);
});
