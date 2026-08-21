import assert from "node:assert/strict";
import test from "node:test";

import { ClientWorldState } from "../src/model/ClientWorldState.ts";

function snapshot(revision = 0) {
  return {
    revision,
    grid: {
      width: 2,
      height: 1,
      cells: [
        { kind: "unoccupied" as const },
        { kind: "occupied" as const, playerId: "owner" },
      ],
    },
  };
}

test("projects snapshots and contiguous deltas immutably", () => {
  const world = new ClientWorldState();
  let publications = 0;
  world.subscribe(() => { publications += 1; });
  const initial = snapshot(2);
  world.replaceSnapshot(initial, true);
  initial.grid.cells[0] = { kind: "occupied", playerId: "mutated" };

  assert.deepEqual(world.getSnapshot().snapshot?.grid.cells[0], {
    kind: "unoccupied",
  });
  assert.equal(world.applyDelta({
    fromRevision: 2,
    revision: 3,
    changes: [{
      position: { x: 0, y: 0 },
      cell: { kind: "occupied", playerId: "new-owner" },
    }],
  }, false), true);
  assert.equal(world.getSnapshot().snapshot?.revision, 3);
  assert.equal(world.getSnapshot().challengeable, false);
  assert.equal(world.getSnapshot().ready, true);
  assert.equal(publications, 2);
});

test("enters resync once on a gap and ignores deltas until replacement", () => {
  const world = new ClientWorldState();
  world.replaceSnapshot(snapshot(5), false);
  assert.equal(world.applyDelta({ fromRevision: 3, revision: 4, changes: [] }, true), false);
  assert.equal(world.getSnapshot().resyncing, true);
  assert.equal(world.applyDelta({ fromRevision: 5, revision: 6, changes: [] }, true), false);
  assert.equal(world.getSnapshot().snapshot?.revision, 5);

  world.replaceSnapshot(snapshot(10), true);
  assert.equal(world.getSnapshot().resyncing, false);
  assert.equal(world.applyDelta({ fromRevision: 10, revision: 11, changes: [] }, false), true);
  assert.equal(world.getSnapshot().snapshot?.revision, 11);
});

test("same-revision snapshots refresh server-authoritative challenge capacity", () => {
  const world = new ClientWorldState();
  world.replaceSnapshot(snapshot(3), false);
  assert.equal(world.getSnapshot().challengeable, false);

  world.replaceSnapshot(snapshot(3), true);
  assert.equal(world.getSnapshot().snapshot?.revision, 3);
  assert.equal(world.getSnapshot().challengeable, true);
  assert.equal(world.getSnapshot().resyncing, false);
});

test("projects a waiting challenge into its authoritative countdown replacement", () => {
  const world = new ClientWorldState();
  world.replaceSnapshot({
    revision: 6,
    grid: {
      width: 1,
      height: 1,
      cells: [{
        kind: "challengeWaiting",
        challengeId: "challenge-1",
        waitingId: 17,
        defenderId: "defender",
        participantIds: ["defender", "challenger"],
      }],
    },
  }, true);

  assert.equal(world.applyDelta({
    fromRevision: 6,
    revision: 7,
    changes: [{
      position: { x: 0, y: 0 },
      cell: {
        kind: "challengePending",
        challengeId: "challenge-1",
        defenderId: "defender",
        participantIds: ["defender", "challenger"],
        closesAt: 25_000,
      },
    }],
  }, true), true);

  assert.deepEqual(world.getSnapshot().snapshot?.grid.cells[0], {
    kind: "challengePending",
    challengeId: "challenge-1",
    defenderId: "defender",
    participantIds: ["defender", "challenger"],
    closesAt: 25_000,
  });
});
