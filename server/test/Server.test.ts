import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkServerMessage } from "@grid-game/shared";
import { BattleCoordinator } from "../src/application/BattleCoordinator.ts";
import { ClientConnection } from "../src/application/ClientConnection.ts";
import { PlayerDirectory } from "../src/application/PlayerDirectory.ts";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import { DebugBattleFactory } from "../src/game/DebugBattleFactory.ts";

function harness(debugEnabled = true, maxDebugPlayers = 8) {
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const coordinator = new BattleCoordinator(
    players,
    battles,
    new DebugBattleFactory({ setInterval: () => 1, clearInterval: () => undefined }),
    { debugEnabled, maxDebugPlayers },
  );
  const connect = () => {
    const messages: NetworkServerMessage[] = [];
    let violations = 0;
    const connection = players.register((playerId) => new ClientConnection(
      playerId,
      coordinator,
      (message) => messages.push(message),
      () => { violations += 1; },
    ));
    connection.sendConnected();
    return { connection, messages, violations: () => violations };
  };
  return { players, battles, coordinator, connect };
}

test("allocates monotonic identities and player snapshots reflect live connections", async () => {
  const app = harness();
  const first = app.connect();
  const second = app.connect();
  assert.deepEqual(first.messages[0], { type: "connected", playerId: "player-1" });
  assert.deepEqual(second.messages[0], { type: "connected", playerId: "player-2" });
  await second.connection.receive({ type: "debugGetPlayerIds", requestId: "players-a" });
  assert.deepEqual(second.messages.at(-1), {
    type: "debugPlayerIds", requestId: "players-a", playerIds: ["player-1", "player-2"],
  });
  app.players.remove(first.connection.playerId);
  first.connection.close();
  const third = app.connect();
  assert.equal(third.connection.playerId, "player-3");
  await third.connection.receive({ type: "debugGetPlayerIds", requestId: "players-b" });
  assert.deepEqual(third.messages.at(-1), {
    type: "debugPlayerIds", requestId: "players-b", playerIds: ["player-2", "player-3"],
  });
  await app.battles.dispose();
});

test("validates debug creation and delivers battleJoined to every participant", async () => {
  const app = harness();
  const first = app.connect();
  const second = app.connect();
  await first.connection.receive({
    type: "debugCreateBattle", requestId: "bad", playerIds: ["player-1", "missing"],
  });
  assert.deepEqual(first.messages.at(-1), {
    type: "debugCreateBattleRejected", requestId: "bad", reason: "unknownPlayer",
  });
  await first.connection.receive({
    type: "debugCreateBattle", requestId: "duplicate", playerIds: ["player-1", "player-1"],
  });
  const duplicate = first.messages.at(-1);
  assert.equal(duplicate?.type === "debugCreateBattleRejected"
    ? duplicate.reason : "", "duplicatePlayerIds");
  await first.connection.receive({
    type: "debugCreateBattle", requestId: "missing-requester", playerIds: ["player-2", "player-3"],
  });
  const missingRequester = first.messages.at(-1);
  assert.equal(missingRequester?.type === "debugCreateBattleRejected"
    ? missingRequester.reason : "", "requesterNotIncluded");
  await first.connection.receive({
    type: "debugCreateBattle", requestId: "create", playerIds: ["player-1", "player-2"],
  });
  const firstJoin = first.messages.at(-1);
  const secondJoin = second.messages.at(-1);
  assert.equal(firstJoin?.type, "battleJoined");
  assert.equal(firstJoin?.type === "battleJoined" ? firstJoin.battleId : "", "battle-1");
  assert.equal(firstJoin?.type === "battleJoined" ? firstJoin.createRequestId : null, "create");
  assert.equal(secondJoin?.type === "battleJoined" ? secondJoin.createRequestId : "x", null);

  await first.connection.receive({ type: "battleMessage", battleId: "battle-1", message: {
    type: "tickProbe", probeId: "probe",
  } });
  assert.deepEqual(first.messages.at(-1), {
    type: "battleMessage", battleId: "battle-1",
    message: { type: "tickProbeResult", probeId: "probe", tick: 0 },
  });
  await first.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  assert.deepEqual(first.messages.at(-1), { type: "battleLeft", battleId: "battle-1" });
  const count = first.messages.length;
  await second.connection.receive({ type: "battleMessage", battleId: "battle-1", message: {
    type: "incrementCell", requestId: "inc", playerId: "player-2", position: { x: 1, y: 0 },
  } });
  assert.equal(first.messages.length, count);
  await app.battles.dispose();
});

test("hosted battles keep probes targeted, broadcast accepted facts, and emit nothing on quiet ticks", async () => {
  let tick: (() => void) | undefined;
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const factory = new DebugBattleFactory({
    setInterval(callback) { tick = callback; return 1; },
    clearInterval() { tick = undefined; },
  });
  const coordinator = new BattleCoordinator(players, battles, factory, { debugEnabled: true });
  const outputs: NetworkServerMessage[][] = [[], []];
  const connections = outputs.map((output) => players.register((playerId) => new ClientConnection(
    playerId, coordinator, (message) => output.push(message), () => undefined,
  )));
  await connections[0]?.receive({
    type: "debugCreateBattle", requestId: "create", playerIds: ["player-1", "player-2"],
  });
  const counts = outputs.map((output) => output.length);
  tick?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(outputs.map((output) => output.length), counts);
  await connections[0]?.receive({ type: "battleMessage", battleId: "battle-1", message: {
    type: "incrementCell", requestId: "increment", playerId: "player-1", position: { x: 0, y: 0 },
  } });
  assert.equal(outputs[0]?.some((message) => message.type === "battleMessage"), true);
  assert.equal(outputs[1]?.some((message) => message.type === "battleMessage"), true);
  const secondCount = outputs[1]?.length;
  await connections[0]?.receive({ type: "battleMessage", battleId: "battle-1", message: {
    type: "tickProbe", probeId: "probe",
  } });
  assert.equal(outputs[1]?.length, secondCount);
  const probe = outputs[0]?.at(-1);
  assert.equal(probe?.type === "battleMessage"
    ? probe.message.type : "", "tickProbeResult");
  await battles.dispose();
});

test("identity spoofing is a protocol violation and debug APIs are gated", async () => {
  const enabled = harness();
  const first = enabled.connect();
  const second = enabled.connect();
  await first.connection.receive({
    type: "debugCreateBattle", requestId: "create", playerIds: ["player-1", "player-2"],
  });
  await first.connection.receive({ type: "battleMessage", battleId: "battle-1", message: {
    type: "incrementCell", requestId: "spoof", playerId: "player-2", position: { x: 1, y: 0 },
  } });
  assert.equal(first.violations(), 1);
  await enabled.battles.dispose();

  const disabled = harness(false);
  const client = disabled.connect();
  await client.connection.receive({ type: "debugGetPlayerIds", requestId: "get" });
  assert.deepEqual(client.messages.at(-1), {
    type: "debugGetPlayerIdsRejected", requestId: "get", reason: "debugDisabled",
  });
  await client.connection.receive({
    type: "debugCreateBattle", requestId: "create", playerIds: ["player-1", "player-2"],
  });
  assert.deepEqual(client.messages.at(-1), {
    type: "debugCreateBattleRejected", requestId: "create", reason: "debugDisabled",
  });
});
