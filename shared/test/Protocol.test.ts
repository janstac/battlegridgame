import assert from "node:assert/strict";
import test from "node:test";

import {
  BattleState,
  applyBattleServerMessage,
  isClientMessage,
  battleEventToServerMessages,
  parseNetworkClientMessage,
  parseNetworkServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "../src/index.ts";
import { ALPHA, BETA, makeGrid, makeSnapshot, occupied } from "./helpers.ts";

test("client protocol is battle-local and supports increments and probes", () => {
  const increment = {
    type: "incrementCell",
    requestId: "request-1",
    position: { x: 2, y: 3 },
  };
  const probe = { type: "tickProbe", probeId: "probe-1" };
  assert.equal(isClientMessage(increment), true);
  assert.deepEqual(parseClientMessage(increment), increment);
  assert.deepEqual(parseClientMessage(probe), probe);
  assert.equal(isClientMessage({ ...increment, battleId: "old-id" }), false);
});

test("network protocol multiplexes battle-local messages without contaminating snapshots", () => {
  const routed = {
    type: "battleMessage",
    battleId: "battle-1",
    message: { type: "tickProbe", probeId: "probe-1" },
  };
  assert.deepEqual(parseNetworkClientMessage(routed), routed);
  assert.throws(() => parseNetworkClientMessage({
    type: "debugGetPlayerIds", requestId: "players-1",
  }));
  assert.deepEqual(parseNetworkServerMessage({
    type: "connected", playerId: "player-1",
  }), { type: "connected", playerId: "player-1" });
  assert.deepEqual(parseNetworkServerMessage({
    type: "connected", playerId: "player-1", resumeToken: "a".repeat(32), resumeGraceMs: 30_000,
  }), { type: "connected", playerId: "player-1", resumeToken: "a".repeat(32), resumeGraceMs: 30_000 });
  assert.equal(parseNetworkServerMessage({
    type: "connected", playerId: "player-1", resumeGraceMs: 0,
  }).type, "connected");
  assert.throws(() => parseNetworkServerMessage({
    type: "connected", playerId: "player-1", resumeGraceMs: -1,
  }));
  assert.throws(() => parseNetworkServerMessage({
    type: "connected", playerId: "player-1", resumeGraceMs: 1.5,
  }));
  assert.throws(() => parseNetworkClientMessage({ ...routed, extra: true }));
});

test("engine events map to ordered server facts including victory cleanup", () => {
  assert.deepEqual(battleEventToServerMessages({
    kind: "battleFinished", winnerId: ALPHA,
  }, 12), [
    { type: "pendingSplitsCleared", tick: 12 },
    { type: "battleStatusChanged", tick: 12, status: { kind: "finished", winnerId: ALPHA } },
  ]);
  assert.deepEqual(battleEventToServerMessages({
    kind: "cellIncremented", position: { x: 1, y: 2 }, participantId: ALPHA,
    previousCount: 1, nextCount: 2, source: "command",
  }, 3), [{
    type: "cellIncremented", tick: 3, position: { x: 1, y: 2 },
    cell: { kind: "occupied", participantId: ALPHA, count: 2 }, source: "command",
  }]);
  assert.deepEqual(battleEventToServerMessages({
    kind: "cooldownStarted",
    participantId: ALPHA,
    nextActionTick: 14,
    durationTicks: 4,
  }, 10), [{
    type: "cooldownChanged",
    tick: 10,
    cooldown: { participantId: ALPHA, nextActionTick: 14, durationTicks: 4 },
  }]);
});

test("server protocol validates individual authoritative facts", () => {
  const messages = [
    {
      type: "cellIncremented",
      tick: 2,
      position: { x: 0, y: 0 },
      cell: { kind: "occupied", participantId: ALPHA, count: 2 },
      source: "command",
    },
    {
      type: "splitScheduled",
      tick: 2,
      split: { position: { x: 0, y: 0 }, dueTick: 10, sequence: 0 },
    },
    {
      type: "cooldownChanged",
      tick: 2,
      cooldown: { participantId: ALPHA, nextActionTick: 6, durationTicks: 4 },
    },
    {
      type: "commandRejected",
      requestId: "request-2",
      reason: "notOwner",
    },
    { type: "tickProbeResult", probeId: "probe-1", tick: 4 },
  ];
  for (const message of messages) {
    assert.deepEqual(parseServerMessage(message), message);
  }
  assert.throws(() => parseServerMessage({
    type: "cellIncremented",
    tick: 0,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 0 },
    source: "command",
  }));
  assert.throws(() => parseServerMessage({
    type: "cooldownChanged",
    tick: 2,
    cooldown: { participantId: ALPHA, nextActionTick: 6 },
  }));
});

test("shared projector copies stated results without applying game rules", () => {
  const snapshot = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]));
  const state = BattleState.restore(snapshot);
  applyBattleServerMessage(state, {
    type: "cellCaptured",
    tick: 7,
    position: { x: 1, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 42 },
  });
  assert.equal(state.tick, 7);
  assert.deepEqual(state.cellAt({ x: 1, y: 0 }), occupied(ALPHA, 42));
});

test("snapshots contain config but no revision or battle id", () => {
  const snapshot = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]));
  assert.deepEqual(snapshot.config, { ticksPerSecond: 20, splitDelayTicks: 10 });
  assert.equal("revision" in snapshot, false);
  assert.equal("battleId" in snapshot, false);
  assert.deepEqual(parseServerMessage({ type: "battleSnapshot", snapshot }), {
    type: "battleSnapshot",
    snapshot,
  });
});
