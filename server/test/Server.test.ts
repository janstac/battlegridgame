import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkServerMessage } from "@grid-game/shared";
import { ClientConnection } from "../src/application/ClientConnection.ts";
import { PlayerDirectory } from "../src/application/PlayerDirectory.ts";
import { WorldCoordinator } from "../src/application/WorldCoordinator.ts";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import { StandardBattleFactory } from "../src/game/StandardBattleFactory.ts";
import type { HostedBattleClock } from "../src/game/HostedBattle.ts";
import type { PendingChallengeClock } from "../src/world/PendingChallenge.ts";
import { World } from "../src/world/World.ts";

class ManualChallengeClock implements PendingChallengeClock {
  nowMs = 1_000;
  private callbacks = new Map<number, { callback(): void; at: number }>();
  private sequence = 1;

  now(): number { return this.nowMs; }
  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.sequence++;
    this.callbacks.set(handle, { callback, at: this.nowMs + delayMs });
    return handle;
  }
  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }
  advance(ms: number): void {
    this.nowMs += ms;
    for (const [handle, entry] of [...this.callbacks]) {
      if (entry.at <= this.nowMs) {
        this.callbacks.delete(handle);
        entry.callback();
      }
    }
  }
}

const battleClock: HostedBattleClock = {
  setInterval: () => 1,
  clearInterval: () => undefined,
};

async function harness(debugEnabled = true) {
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const world = new World({ random: { next: () => 0 } });
  const challengeClock = new ManualChallengeClock();
  const coordinator = new WorldCoordinator(
    players,
    battles,
    world,
    new StandardBattleFactory(battleClock),
    { debugEnabled, challengeClock },
  );
  const connect = async () => {
    const messages: NetworkServerMessage[] = [];
    let violations = 0;
    const connection = players.register((playerId) => new ClientConnection(
      playerId,
      coordinator,
      (message) => messages.push(message),
      () => { violations += 1; },
    ));
    await connection.open();
    return { connection, messages, violations: () => violations };
  };
  return { players, battles, world, challengeClock, coordinator, connect };
}

test("connection bootstrap assigns two cells and publishes later allocations", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  assert.deepEqual(first.messages.map(({ type }) => type), ["connected", "worldSnapshot"]);
  assert.equal(app.world.snapshot().grid.cells.filter(
    (cell) => cell.kind === "occupied" && cell.playerId === "player-1",
  ).length, 2);

  const second = await app.connect();
  assert.equal(first.messages.at(-1)?.type, "worldDelta");
  assert.deepEqual(second.messages.slice(0, 2).map(({ type }) => type), [
    "connected",
    "worldSnapshot",
  ]);
  assert.equal(second.messages[1]?.type === "worldSnapshot"
    ? second.messages[1].snapshot.revision : -1, app.world.revision);
});

test("challenge creation rejects self challenges, accepts public joins, and cancels on leave", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const third = await app.connect();

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "self", position: { x: 0, y: 0 },
  });
  assert.deepEqual(first.messages.at(-1), {
    type: "worldCommandRejected", requestId: "self", reason: "selfChallenge",
  });

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "challenge", position: { x: 2, y: 0 },
  });
  assert.equal(first.messages.at(-1)?.type, "worldCommandAccepted");
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");
  if (pending.kind !== "challengePending") return;
  assert.deepEqual(pending.participantIds, ["player-2", "player-1"]);

  await third.connection.receive({
    type: "joinWorldChallenge", requestId: "join", challengeId: pending.challengeId,
  });
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), {
    ...pending,
    participantIds: ["player-2", "player-1", "player-3"],
  });
  await first.connection.receive({
    type: "leaveWorldChallenge", requestId: "leave", challengeId: pending.challengeId,
  });
  await third.connection.receive({
    type: "leaveWorldChallenge", requestId: "cancel", challengeId: pending.challengeId,
  });
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), {
    kind: "occupied", playerId: "player-2",
  });
});

test("expiry starts one participant-only battle and explicit leave withdraws", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const observer = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell", requestId: "challenge", position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");
  const observerCount = observer.messages.length;

  app.challengeClock.advance(5_000);
  await app.coordinator.requestWorldSnapshot(first.connection);
  const cell = app.world.cellAt({ x: 2, y: 0 });
  assert.deepEqual(cell, {
    kind: "battle", battleId: "battle-1", playerIds: ["player-2", "player-1"],
  });
  const firstJoin = first.messages.find((message) => message.type === "battleJoined");
  const secondJoin = second.messages.find((message) => message.type === "battleJoined");
  assert.equal(firstJoin?.type === "battleJoined" ? firstJoin.localParticipantId : -1, 1);
  assert.equal(secondJoin?.type === "battleJoined" ? secondJoin.localParticipantId : -1, 0);
  assert.equal(observer.messages.slice(observerCount).some(
    (message) => message.type === "battleJoined" || message.type === "battleMessage",
  ), false);

  await first.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  await app.coordinator.requestWorldSnapshot(second.connection);
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), {
    kind: "occupied", playerId: "player-2",
  });
  assert.equal(app.battles.get("battle-1"), undefined);
  assert.equal(first.messages.some(
    (message) => message.type === "battleLeft" && message.battleId === "battle-1",
  ), true);
  assert.equal(second.messages.some(
    (message) => message.type === "battleLeft" && message.battleId === "battle-1",
  ), true);
});

test("disconnect cancels defended challenges, clears ownership, and removes identity", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell", requestId: "challenge", position: { x: 2, y: 0 },
  });
  await second.connection.close();
  await app.coordinator.requestWorldSnapshot(first.connection);

  assert.equal(app.players.get("player-2"), undefined);
  assert.equal(app.world.snapshot().grid.cells.some(
    (cell) => cell.kind === "occupied" && cell.playerId === "player-2",
  ), false);
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), { kind: "unoccupied" });
});

test("simultaneous battle disconnects cannot award a cell to a closed player", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell", requestId: "challenge", position: { x: 2, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.requestWorldSnapshot(first.connection);
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "battle");

  await Promise.all([first.connection.close(), second.connection.close()]);

  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), { kind: "unoccupied" });
  assert.equal(app.world.snapshot().grid.cells.some(
    (cell) => cell.kind === "occupied"
      && (cell.playerId === "player-1" || cell.playerId === "player-2"),
  ), false);
});

test("the internal detached battle helper remains gated", async (t) => {
  const disabled = await harness(false);
  t.after(async () => { await disabled.coordinator.dispose(); await disabled.battles.dispose(); });
  const client = await disabled.connect();
  assert.equal(
    await disabled.coordinator.createDebugBattle(client.connection, ["player-1", "player-2"]),
    "debugDisabled",
  );

  const enabled = await harness(true);
  t.after(async () => { await enabled.coordinator.dispose(); await enabled.battles.dispose(); });
  const first = await enabled.connect();
  await enabled.connect();
  assert.equal(await enabled.coordinator.createDebugBattle(
    first.connection,
    ["player-1", "player-2"],
  ), null);
  const joined = first.messages.find((message) => message.type === "battleJoined");
  assert.equal(joined?.type === "battleJoined" ? joined.localParticipantId : -1, 0);
  await first.connection.receive({
    type: "battleMessage", battleId: "battle-1",
    message: { type: "incrementCell", requestId: "increment", position: { x: 1, y: 1 } },
  });
  assert.equal(first.violations(), 0);
  assert.equal(first.messages.some(
    (message) => message.type === "battleMessage" && message.message.type === "cellIncremented",
  ), true);
});
