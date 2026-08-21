import assert from "node:assert/strict";
import test from "node:test";

import { ClientBattleState } from "../src/model/ClientBattleState.ts";
import { cooldownProgress } from "../src/view/cooldownProgress.ts";
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
  assert.equal(battle.getSnapshot().localCommandPending, true);
  await pending;
  assert.deepEqual(connection.sent, [{
    type: "incrementCell",
    requestId: "request-1",
    position: { x: 2, y: 1 },
  }]);
  assert.equal(battle.getSnapshot().localParticipantId, BETA);
  assert.equal(battle.getSnapshot().localCommandPending, true);
  connection.emit({
    type: "cooldownChanged",
    tick: 0,
    cooldown: { participantId: BETA, nextActionTick: 10, durationTicks: 10, acceptedActionCount: 1 },
  });
  assert.equal(battle.getSnapshot().localCommandPending, false);
  await battle.dispose();
});

test("keeps interaction pending until the matching command is resolved", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  let sequence = 0;
  const battle = new ClientBattleState(connection, ALPHA, {
    clock,
    requestIdFactory: () => `request-${sequence++}`,
  });

  const firstRequest = battle.increment({ x: 0, y: 0 });
  const duplicateRequest = battle.increment({ x: 0, y: 0 });
  const [firstRequestId, duplicateRequestId] = await Promise.all([
    firstRequest,
    duplicateRequest,
  ]);
  assert.equal(firstRequestId, "request-0");
  assert.equal(duplicateRequestId, firstRequestId);
  assert.equal(connection.sent.length, 1);
  assert.equal(battle.getSnapshot().localCommandPending, true);
  connection.emit({
    type: "cooldownChanged",
    tick: 0,
    cooldown: { participantId: BETA, nextActionTick: 10, durationTicks: 10, acceptedActionCount: 1 },
  });
  assert.equal(battle.getSnapshot().localCommandPending, true);
  connection.emit({
    type: "commandRejected",
    requestId: "request-0",
    reason: "cooldownActive",
  });
  assert.equal(battle.getSnapshot().localCommandPending, false);

  await battle.increment({ x: 0, y: 0 });
  assert.equal(battle.getSnapshot().localCommandPending, true);
  connection.emit({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot(),
  });
  assert.equal(battle.getSnapshot().localCommandPending, false);
  await battle.dispose();
});

test("clears pending interaction when sending the command fails", async () => {
  const connection = new RecordingBattleEngineConnection();
  connection.send = async () => {
    throw new Error("send failed");
  };
  const battle = new ClientBattleState(connection, ALPHA, {
    clock: new ManualBattleClock(),
  });

  await assert.rejects(
    battle.increment({ x: 0, y: 0 }),
    /send failed/,
  );
  assert.equal(battle.getSnapshot().localCommandPending, false);
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

test("stores rejection feedback and estimates ticks between authoritative facts", async () => {
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

test("authoritative probes correct a tick estimate that ran ahead", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  let sequence = 0;
  const battle = new ClientBattleState(connection, ALPHA, {
    clock,
    probeIntervalMs: 1_000,
    requestIdFactory: () => `probe-${sequence++}`,
  });

  clock.runTicks(20, 50);
  await Promise.resolve();
  assert.equal(battle.getSnapshot().estimatedTick, 20);
  assert.deepEqual(connection.sent.at(-1), {
    type: "tickProbe",
    probeId: "probe-0",
  });
  connection.emit({ type: "tickProbeResult", probeId: "probe-0", tick: 18 });
  assert.equal(battle.getSnapshot().estimatedTick, 18);
  await battle.dispose();
});

test("local cooldown facts start a full bar that decreases with the battle clock", async () => {
  const connection = new RecordingBattleEngineConnection();
  const clock = new ManualBattleClock();
  const battle = new ClientBattleState(connection, ALPHA, { clock });

  connection.emit({
    type: "cooldownChanged",
    tick: 7,
    cooldown: { participantId: ALPHA, nextActionTick: 17, durationTicks: 10, acceptedActionCount: 1 },
  });
  let state = battle.getSnapshot();
  assert.equal(state.estimatedTick, 7);
  assert.deepEqual(cooldownProgress(state.battle.cooldowns[0], state.estimatedTick), {
    remainingTicks: 10,
    ratio: 1,
  });

  clock.runTicks(5, 50);
  state = battle.getSnapshot();
  assert.equal(state.estimatedTick, 12);
  assert.deepEqual(cooldownProgress(state.battle.cooldowns[0], state.estimatedTick), {
    remainingTicks: 5,
    ratio: 0.5,
  });
  await battle.dispose();
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
