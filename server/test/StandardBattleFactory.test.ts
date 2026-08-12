import assert from "node:assert/strict";
import test from "node:test";
import { StandardBattleFactory, STANDARD_BATTLE_MAX_PARTICIPANTS } from "../src/game/StandardBattleFactory.ts";

test("creates the standard inset layout with battle-local participant identities", () => {
  const factory = new StandardBattleFactory();
  const battle = factory.create(["alice", "bob", "carol", "dave"], { x: 4, y: 6 });
  const snapshot = battle.snapshot;

  assert.equal(STANDARD_BATTLE_MAX_PARTICIPANTS, 4);
  assert.deepEqual(snapshot.participants, [
    { participantId: 0, status: "active" },
    { participantId: 1, status: "active" },
    { participantId: 2, status: "active" },
    { participantId: 3, status: "active" },
  ]);
  assert.deepEqual(battle.getRoster(), [
    { participantId: 0, playerId: "alice", status: "active" },
    { participantId: 1, playerId: "bob", status: "active" },
    { participantId: 2, playerId: "carol", status: "active" },
    { participantId: 3, playerId: "dave", status: "active" },
  ]);
  assert.deepEqual(snapshot.grid, {
    width: 7,
    height: 7,
    cells: snapshot.grid.cells,
  });
  const cellAt = (x: number, y: number) => snapshot.grid.cells[y * snapshot.grid.width + x];
  assert.deepEqual(cellAt(1, 1), { kind: "occupied", participantId: 0, count: 1 });
  assert.deepEqual(cellAt(5, 1), { kind: "occupied", participantId: 1, count: 1 });
  assert.deepEqual(cellAt(5, 5), { kind: "occupied", participantId: 2, count: 1 });
  assert.deepEqual(cellAt(1, 5), { kind: "occupied", participantId: 3, count: 1 });
  assert.deepEqual(cellAt(3, 3), { kind: "wall" });
  assert.deepEqual(battle.worldPosition, { x: 4, y: 6 });
  assert.equal(battle.participantIdForPlayer("carol"), 2);
  assert.equal(battle.playerIdForParticipant(3), "dave");
});
test("copies the optional World position instead of exposing mutable state", () => {
  const position = { x: 2, y: 3 };
  const battle = new StandardBattleFactory().create(["alice", "bob"], position);
  position.x = 99;
  const firstRead = battle.worldPosition;
  assert.deepEqual(firstRead, { x: 2, y: 3 });
  if (firstRead !== null) firstRead.y = 99;
  assert.deepEqual(battle.worldPosition, { x: 2, y: 3 });
});

test("requires two to four distinct non-empty global players", () => {
  const factory = new StandardBattleFactory();
  assert.throws(() => factory.create(["alice"]), /require 2-4 players/);
  assert.throws(
    () => factory.create(["a", "b", "c", "d", "e"]),
    /require 2-4 players/,
  );
  assert.throws(() => factory.create(["alice", "alice"]), /unique players/);
  assert.throws(() => factory.create(["alice", ""]), /non-empty/);
});
