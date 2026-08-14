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

test("allocates the last safe ID once and then reports exhaustion", () => {
  const queue = new WaitingChallengeQueue();
  (queue as unknown as { nextSequence: number | null }).nextSequence =
    Number.MAX_SAFE_INTEGER;

  assert.equal(queue.enqueue("challenge-last"), Number.MAX_SAFE_INTEGER);
  assert.equal(queue.enqueue("challenge-last"), Number.MAX_SAFE_INTEGER);
  assert.throws(
    () => queue.enqueue("challenge-overflow"),
    /identifier space is exhausted/,
  );
  assert.deepEqual(queue.entriesInOrder(), [{
    challengeId: "challenge-last",
    waitingId: Number.MAX_SAFE_INTEGER,
  }]);
});
