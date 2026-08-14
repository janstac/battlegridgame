import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_CONCURRENT_BATTLES_PER_PLAYER,
  PlayerBattleCapacity,
  validateMaxConcurrentBattlesPerPlayer,
} from "../src/application/PlayerBattleCapacity.ts";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import { createGridGameServer } from "../src/server.ts";

test("defaults to four and validates positive safe integer overrides", () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_BATTLES_PER_PLAYER, 4);
  assert.equal(validateMaxConcurrentBattlesPerPlayer(1), 1);
  assert.equal(validateMaxConcurrentBattlesPerPlayer(9), 9);
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateMaxConcurrentBattlesPerPlayer(invalid),
      /positive safe integer/,
    );
  }
});

test("reserves whole rosters atomically and releases individual members", () => {
  const capacity = new PlayerBattleCapacity(new BattleRegistry(), 1);
  assert.equal(capacity.reserveRoster("challenge-1", ["first", "second"]), true);
  assert.equal(
    capacity.hasReservationsForRoster("challenge-1", ["first", "second"]),
    true,
  );
  assert.equal(
    capacity.hasReservationsForRoster("challenge-1", ["first", "third"]),
    false,
  );
  assert.equal(
    capacity.hasReservationsForRoster("challenge-1", ["first", "first"]),
    false,
  );
  assert.equal(capacity.committed("first"), 1);
  assert.equal(capacity.reserveRoster("challenge-2", ["first", "third"]), false);
  assert.deepEqual(capacity.reservedRoster("challenge-2"), []);
  assert.equal(capacity.committed("third"), 0);

  assert.equal(capacity.reservePlayer("challenge-1", "third"), true);
  assert.equal(capacity.hasCapacity("third"), false);
  assert.equal(capacity.releasePlayer("challenge-1", "third"), true);
  assert.equal(capacity.hasCapacity("third"), true);
  assert.deepEqual(capacity.releaseChallenge("challenge-1"), ["first", "second"]);
  assert.equal(capacity.reservationSize, 0);
});

test("rejects duplicate rosters without changing reservation state", () => {
  const capacity = new PlayerBattleCapacity(new BattleRegistry(), 2);
  assert.equal(capacity.reserveRoster("challenge-1", ["first", "first"]), false);
  assert.equal(capacity.reservationSize, 0);
});

test("server composition resolves the default and rejects invalid overrides", async () => {
  const defaultServer = createGridGameServer();
  assert.equal(defaultServer.coordinator.maxConcurrentBattlesPerPlayer, 4);
  await defaultServer.close();

  const overridden = createGridGameServer({ maxConcurrentBattlesPerPlayer: 7 });
  assert.equal(overridden.coordinator.maxConcurrentBattlesPerPlayer, 7);
  await overridden.close();

  for (const invalid of [0, -2, 2.25, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => createGridGameServer({ maxConcurrentBattlesPerPlayer: invalid }),
      /positive safe integer/,
    );
  }
});
