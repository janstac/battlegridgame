import assert from "node:assert/strict";
import test from "node:test";

import type { WorldDelta } from "@grid-game/shared";
import {
  World,
  WorldCellConflictError,
  WorldRuntimeIndexConflictError,
  type RandomSource,
} from "../src/world/World.ts";

class SequenceRandom implements RandomSource {
  private readonly samples: number[];

  constructor(samples: number[]) {
    this.samples = samples;
  }

  next(): number {
    const sample = this.samples.shift();
    if (sample === undefined) throw new Error("No random sample available");
    return sample;
  }
}

test("World defaults to an independent 10x10 revision-zero snapshot", () => {
  const world = new World();
  const snapshot = world.snapshot();

  assert.equal(world.width, 10);
  assert.equal(world.height, 10);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.grid.cells.length, 100);
  assert.equal(snapshot.grid.cells.every((cell) => cell.kind === "unoccupied"), true);

  snapshot.grid.cells[0] = { kind: "occupied", playerId: "tamper" };
  assert.deepEqual(world.cellAt({ x: 0, y: 0 }), { kind: "unoccupied" });
});

test("initial allocation selects distinct cells uniformly without replacement in one delta", () => {
  const world = new World({
    width: 3,
    height: 2,
    random: new SequenceRandom([0.99, 0]),
  });
  const deltas: WorldDelta[] = [];
  world.subscribe((delta) => deltas.push(delta));

  const allocated = world.allocateUnoccupiedCells("player-1");

  assert.deepEqual(allocated, [{ x: 2, y: 1 }, { x: 1, y: 0 }]);
  assert.equal(world.revision, 1);
  assert.equal(deltas.length, 1);
  assert.deepEqual(deltas[0], {
    fromRevision: 0,
    revision: 1,
    changes: allocated.map((position) => ({
      position,
      cell: { kind: "occupied", playerId: "player-1" },
    })),
  });
});

test("allocation takes only remaining free cells and clearing ownership is atomic", () => {
  const world = new World({ width: 2, height: 1, random: new SequenceRandom([0]) });
  world.replaceCell(
    { x: 0, y: 0 },
    { kind: "unoccupied" },
    { kind: "occupied", playerId: "player-1" },
  );
  const allocated = world.allocateUnoccupiedCells("player-1");
  assert.deepEqual(allocated, [{ x: 1, y: 0 }]);

  const beforeClear = world.revision;
  const cleared = world.clearOccupiedCells("player-1");
  assert.deepEqual(cleared, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  assert.equal(world.revision, beforeClear + 1);
  assert.deepEqual(world.snapshot().grid.cells, [
    { kind: "unoccupied" },
    { kind: "unoccupied" },
  ]);

  assert.deepEqual(world.allocateUnoccupiedCells("player-2", 0), []);
  assert.equal(world.clearOccupiedCells("missing").length, 0);
  assert.equal(world.revision, beforeClear + 1);
});

test("batch preconditions fail without a partial mutation", () => {
  const world = new World({ width: 2, height: 1 });

  assert.throws(() => world.replaceCells([
    {
      position: { x: 0, y: 0 },
      expected: { kind: "unoccupied" },
      cell: { kind: "occupied", playerId: "player-1" },
    },
    {
      position: { x: 1, y: 0 },
      expected: { kind: "occupied", playerId: "player-2" },
      cell: { kind: "unoccupied" },
    },
  ]), WorldCellConflictError);

  assert.equal(world.revision, 0);
  assert.deepEqual(world.snapshot().grid.cells, [
    { kind: "unoccupied" },
    { kind: "unoccupied" },
  ]);
});

test("challenge and battle indexes follow validated replacements", () => {
  const world = new World({ width: 2, height: 1 });
  world.replaceCell(
    { x: 0, y: 0 },
    { kind: "unoccupied" },
    {
      kind: "challengePending",
      challengeId: "challenge-1",
      defenderId: "defender",
      participantIds: ["defender", "challenger"],
      closesAt: 10_000,
    },
  );
  assert.deepEqual(world.positionForChallenge("challenge-1"), { x: 0, y: 0 });

  world.replaceCell(
    { x: 0, y: 0 },
    { kind: "challengePending", challengeId: "challenge-1" },
    {
      kind: "challengeWaiting",
      challengeId: "challenge-1",
      waitingId: 1,
      defenderId: "defender",
      participantIds: ["defender", "challenger"],
    },
  );
  assert.deepEqual(world.positionForChallenge("challenge-1"), { x: 0, y: 0 });

  assert.throws(() => world.replaceCell(
    { x: 1, y: 0 },
    { kind: "unoccupied" },
    {
      kind: "challengeWaiting",
      challengeId: "challenge-1",
      waitingId: 2,
      defenderId: "other",
      participantIds: ["other", "third"],
    },
  ), WorldRuntimeIndexConflictError);
  assert.equal(world.revision, 2);

  world.replaceCell(
    { x: 0, y: 0 },
    { kind: "challengeWaiting", challengeId: "challenge-1" },
    { kind: "battle", battleId: "battle-1", playerIds: ["defender", "challenger"] },
  );
  assert.equal(world.positionForChallenge("challenge-1"), undefined);
  assert.deepEqual(world.positionForBattle("battle-1"), { x: 0, y: 0 });
});

test("invalid random values and duplicate positions cannot mutate the World", () => {
  const world = new World({ width: 1, height: 1, random: new SequenceRandom([1]) });
  assert.throws(() => world.allocateUnoccupiedCells("player-1"), /\[0, 1\)/);
  assert.equal(world.revision, 0);

  assert.throws(() => world.replaceCells([
    {
      position: { x: 0, y: 0 },
      expected: { kind: "unoccupied" },
      cell: { kind: "occupied", playerId: "one" },
    },
    {
      position: { x: 0, y: 0 },
      expected: { kind: "unoccupied" },
      cell: { kind: "occupied", playerId: "two" },
    },
  ]), /duplicate position/);
  assert.equal(world.revision, 0);
});

test("subscribers receive isolated delta copies and may unsubscribe", () => {
  const world = new World({ width: 1, height: 1 });
  let calls = 0;
  const unsubscribe = world.subscribe((delta) => {
    calls += 1;
    delta.changes[0]!.position.x = 99;
  });
  const returned = world.replaceCell(
    { x: 0, y: 0 },
    { kind: "unoccupied" },
    { kind: "occupied", playerId: "player-1" },
  );
  assert.deepEqual(returned.changes[0]?.position, { x: 0, y: 0 });
  unsubscribe();
  world.clearOccupiedCells("player-1");
  assert.equal(calls, 1);
});
