import assert from "node:assert/strict";
import test from "node:test";

import { ClientBattleState } from "../src/model/ClientBattleState.ts";
import {
  ALPHA,
  BETA,
  createBattleSnapshot,
  ManualBattleClock,
  RecordingBattleEngineConnection,
} from "./helpers.ts";

test("sends actor-free intents using the local participant stored in client state", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  const battle = new ClientBattleState(connection, BETA, {
    clock,
    requestIdFactory: () => "request-1",
  });

  const pending = battle.increment({ x: 2, y: 1 });
  assert.deepEqual(connection.sent, []);
  await pending;
  assert.deepEqual(connection.sent, [{
    type: "incrementCell",
    requestId: "request-1",
    position: { x: 2, y: 1 },
  }]);
  assert.equal(battle.getSnapshot().localParticipantId, BETA);
  await battle.dispose();
});

test("projects individual authoritative messages without deriving game rules", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  const battle = new ClientBattleState(connection, ALPHA, { clock });
  const observed: unknown[] = [];
  battle.subscribe(() => observed.push(battle.getSnapshot()));

  connection.emit({
    type: "cellIncremented",
    tick: 3,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 9 },
    source: "command",
  });
  connection.emit({
    type: "splitScheduled",
    tick: 3,
    split: { position: { x: 0, y: 0 }, dueTick: 10, sequence: 4 },
  });

  const state = battle.getSnapshot();
  assert.equal(state.battle.grid.cells[0]?.kind, "occupied");
  assert.equal(
    state.battle.grid.cells[0]?.kind === "occupied"
      ? state.battle.grid.cells[0].count
      : 0,
    9,
  );
  assert.deepEqual(state.battle.pendingSplits, [
    { position: { x: 0, y: 0 }, dueTick: 10, sequence: 4 },
  ]);
  assert.equal(observed.length, 2);
  await battle.dispose();
});

test("stores rejection feedback and estimates monotonic ticks", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  const battle = new ClientBattleState(connection, ALPHA, {
    clock,
    probeIntervalMs: 1_000,
  });
  connection.emit({
    type: "commandRejected",
    requestId: "rejected",
    reason: "cooldownActive",
  });
  assert.equal(battle.getSnapshot().lastRejection?.reason, "cooldownActive");

  clock.runTicks(2, 50);
  assert.equal(battle.getSnapshot().estimatedTick, 2);
  clock.runTicks(1, 50);
  assert.equal(battle.getSnapshot().estimatedTick, 3);
  await battle.dispose();
  assert.equal(connection.closeCount, 1);
});

test("preserves rejection across unrelated facts and clears it on replacement", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  const battle = new ClientBattleState(connection, ALPHA, { clock });

  connection.emit({
    type: "commandRejected",
    requestId: "rejected",
    reason: "cooldownActive",
  });
  connection.emit({
    type: "cellIncremented",
    tick: 1,
    position: { x: 2, y: 1 },
    cell: { kind: "occupied", participantId: BETA, count: 2 },
    source: "command",
  });
  assert.deepEqual(battle.getSnapshot().lastRejection, {
    requestId: "rejected",
    reason: "cooldownActive",
  });

  connection.emit({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot(),
  });
  assert.equal(battle.getSnapshot().lastRejection, null);
  await battle.dispose();
});
