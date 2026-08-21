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

async function harness(
  debugEnabled = true,
  maxConcurrentBattlesPerPlayer = 4,
  factory: StandardBattleFactory = new StandardBattleFactory(battleClock),
) {
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const world = new World({ random: { next: () => 0 } });
  const challengeClock = new ManualChallengeClock();
  const coordinator = new WorldCoordinator(
    players,
    battles,
    world,
    factory,
    { debugEnabled, challengeClock, maxConcurrentBattlesPerPlayer },
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

test("stale messages for a detached battle do not close the player connection", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const client = await app.connect();

  await client.connection.receive({
    type: "battleMessage",
    battleId: "battle-finished",
    message: { type: "tickProbe", probeId: "stale-probe" },
  });

  assert.equal(client.violations(), 0);
  assert.equal(client.connection.isClosed, false);
  await client.connection.receive({ type: "requestWorldSnapshot" });
  assert.equal(client.messages.at(-1)?.type, "worldSnapshot");
});

test("debug battle creation preflights whole-roster capacity without side effects", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const roster = [first.connection.playerId, second.connection.playerId];
  assert.equal(await app.coordinator.createDebugBattle(first.connection, roster), null);
  const snapshot = app.world.snapshot();
  const messageCounts = [first.messages.length, second.messages.length];

  assert.equal(
    await app.coordinator.createDebugBattle(first.connection, roster),
    "battleLimitReached",
  );
  assert.equal(app.battles.entries().length, 1);
  assert.deepEqual(app.world.snapshot(), snapshot);
  assert.equal(first.messages.length, messageCounts[0]);
  assert.equal(second.messages.length, messageCounts[1]);
});

test("World updates publish per-player challenge capacity and refresh it on release", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const challenger = await app.connect();
  const defender = await app.connect();
  const observer = await app.connect();

  await challenger.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");
  if (pending.kind !== "challengePending") return;

  const challengerUpdate = challenger.messages.filter(
    (message) => message.type === "worldSnapshot" || message.type === "worldDelta",
  ).at(-1);
  const defenderUpdate = defender.messages.filter(
    (message) => message.type === "worldSnapshot" || message.type === "worldDelta",
  ).at(-1);
  const observerUpdate = observer.messages.filter(
    (message) => message.type === "worldSnapshot" || message.type === "worldDelta",
  ).at(-1);
  assert.equal(challengerUpdate?.challengeable, false);
  assert.equal(defenderUpdate?.challengeable, false);
  assert.equal(observerUpdate?.challengeable, true);

  await challenger.connection.receive({
    type: "leaveWorldChallenge",
    requestId: "cancel",
    challengeId: pending.challengeId,
  });
  const releasedUpdate = challenger.messages.filter(
    (message) => message.type === "worldSnapshot" || message.type === "worldDelta",
  ).at(-1);
  assert.equal(releasedUpdate?.type, "worldSnapshot");
  assert.equal(releasedUpdate?.challengeable, true);
  assert.equal(
    releasedUpdate?.type === "worldSnapshot" ? releasedUpdate.snapshot.revision : -1,
    app.world.revision,
  );
});

test("countdown reservations reject capped creators and joiners", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const third = await app.connect();
  const fourth = await app.connect();
  const fifth = await app.connect();

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "first", position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "capped-create", position: { x: 4, y: 0 },
  });
  assert.deepEqual(first.messages.at(-1), {
    type: "worldCommandRejected",
    requestId: "capped-create",
    reason: "battleLimitReached",
  });
  if (pending.kind !== "challengePending") return;
  await third.connection.receive({
    type: "joinWorldChallenge", requestId: "join", challengeId: pending.challengeId,
  });
  assert.equal(third.messages.at(-1)?.type, "worldCommandAccepted");
  await third.connection.receive({
    type: "challengeWorldCell", requestId: "reserved-create", position: { x: 6, y: 0 },
  });
  assert.deepEqual(third.messages.at(-1), {
    type: "worldCommandRejected",
    requestId: "reserved-create",
    reason: "battleLimitReached",
  });

  await app.coordinator.createDebugBattle(
    fourth.connection,
    [fourth.connection.playerId, fifth.connection.playerId],
  );
  const otherPending = app.world.cellAt({ x: 2, y: 0 });
  if (otherPending.kind !== "challengePending") return;
  await fourth.connection.receive({
    type: "joinWorldChallenge",
    requestId: "capped-join",
    challengeId: otherPending.challengeId,
  });
  assert.deepEqual(fourth.messages.at(-1), {
    type: "worldCommandRejected",
    requestId: "capped-join",
    reason: "battleLimitReached",
  });
});

test("eligible challengers create Waiting against capped defenders", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const opponent = await app.connect();
  const challenger = await app.connect();
  const waitingJoiner = await app.connect();
  const otherDefender = await app.connect();
  assert.equal(await app.coordinator.createDebugBattle(
    defender.connection,
    [defender.connection.playerId, opponent.connection.playerId],
  ), null);

  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 0, y: 0 },
  });
  const waiting = app.world.cellAt({ x: 0, y: 0 });
  assert.deepEqual(waiting, {
    kind: "challengeWaiting",
    challengeId: "challenge-1",
    waitingId: 1,
    defenderId: defender.connection.playerId,
    participantIds: [defender.connection.playerId, challenger.connection.playerId],
  });
  if (waiting.kind !== "challengeWaiting") return;

  await waitingJoiner.connection.receive({
    type: "joinWorldChallenge", requestId: "waiting-join", challengeId: waiting.challengeId,
  });
  assert.equal(waitingJoiner.messages.at(-1)?.type, "worldCommandAccepted");
  await waitingJoiner.connection.receive({
    type: "challengeWorldCell", requestId: "still-free", position: { x: 8, y: 0 },
  });
  assert.equal(waitingJoiner.messages.at(-1)?.type, "worldCommandAccepted");
});

test("capacity release promotes Waiting and does not reuse Waiting IDs", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const opponent = await app.connect();
  const firstChallenger = await app.connect();
  const secondChallenger = await app.connect();
  await app.coordinator.createDebugBattle(
    defender.connection,
    [defender.connection.playerId, opponent.connection.playerId],
  );

  await firstChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "first-wait", position: { x: 0, y: 0 },
  });
  const firstWaiting = app.world.cellAt({ x: 0, y: 0 });
  assert.equal(firstWaiting.kind === "challengeWaiting" ? firstWaiting.waitingId : -1, 1);
  if (firstWaiting.kind !== "challengeWaiting") return;
  await firstChallenger.connection.receive({
    type: "leaveWorldChallenge", requestId: "cancel", challengeId: firstWaiting.challengeId,
  });

  await secondChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "second-wait", position: { x: 1, y: 0 },
  });
  const secondWaiting = app.world.cellAt({ x: 1, y: 0 });
  assert.equal(secondWaiting.kind === "challengeWaiting" ? secondWaiting.waitingId : -1, 2);

  await defender.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  await app.coordinator.adminGetWorld();
  const promoted = app.world.cellAt({ x: 1, y: 0 });
  assert.equal(promoted.kind, "challengePending");
  assert.equal(promoted.kind === "challengePending" ? promoted.challengeId : null, "challenge-2");
});

test("promotion skips an older blocked roster and restores its ID priority later", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const firstDefender = await app.connect();
  const firstOpponent = await app.connect();
  const secondDefender = await app.connect();
  const secondOpponent = await app.connect();
  const firstChallenger = await app.connect();
  const secondChallenger = await app.connect();
  await app.coordinator.createDebugBattle(firstDefender.connection, [
    firstDefender.connection.playerId, firstOpponent.connection.playerId,
  ]);
  await app.coordinator.createDebugBattle(secondDefender.connection, [
    secondDefender.connection.playerId, secondOpponent.connection.playerId,
  ]);
  await firstChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "older", position: { x: 0, y: 0 },
  });
  await secondChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "younger", position: { x: 4, y: 0 },
  });
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengeWaiting");
  assert.equal(app.world.cellAt({ x: 4, y: 0 }).kind, "challengeWaiting");

  await secondDefender.connection.receive({ type: "leaveBattle", battleId: "battle-2" });
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengeWaiting");
  assert.equal(app.world.cellAt({ x: 4, y: 0 }).kind, "challengePending");

  await firstDefender.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengePending");
});

test("countdown cancellation releases reservations before promoting Waiting", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const defender = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell", requestId: "countdown", position: { x: 2, y: 0 },
  });
  await second.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 3, y: 0 },
  });
  const countdown = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(countdown.kind, "challengePending");
  assert.equal(app.world.cellAt({ x: 3, y: 0 }).kind, "challengeWaiting");
  if (countdown.kind !== "challengePending") return;

  await first.connection.receive({
    type: "leaveWorldChallenge", requestId: "cancel", challengeId: countdown.challengeId,
  });
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "occupied");
  assert.equal(app.world.cellAt({ x: 3, y: 0 }).kind, "challengePending");
  assert.equal(defender.messages.some(
    (message) => message.type === "worldCommandRejected",
  ), false);
});

test("expiry creation failure rolls back the cell and releases reservations", async (t) => {
  class FailingBattleFactory extends StandardBattleFactory {
    override create(): never { throw new Error("factory failed"); }
  }
  const app = await harness(true, 1, new FailingBattleFactory(battleClock));
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const challenger = await app.connect();
  await app.connect();
  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "first", position: { x: 2, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), {
    kind: "occupied", playerId: "player-2",
  });
  assert.deepEqual(app.battles.entries(), []);

  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "retry", position: { x: 2, y: 0 },
  });
  assert.equal(challenger.messages.at(-1)?.type, "worldCommandAccepted");
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "challengePending");
});

test("countdown-to-battle conversion preserves the occupied capacity slot", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  await app.connect();
  await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell", requestId: "countdown", position: { x: 2, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "battle");

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "active", position: { x: 4, y: 0 },
  });
  assert.deepEqual(first.messages.at(-1), {
    type: "worldCommandRejected",
    requestId: "active",
    reason: "battleLimitReached",
  });
});

test("disconnect cancels Waiting without leaking its queue lifetime", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const opponent = await app.connect();
  const challenger = await app.connect();
  const nextChallenger = await app.connect();
  await app.coordinator.createDebugBattle(defender.connection, [
    defender.connection.playerId, opponent.connection.playerId,
  ]);
  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 0, y: 0 },
  });
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengeWaiting");
  await challenger.connection.close();
  assert.deepEqual(app.world.cellAt({ x: 0, y: 0 }), {
    kind: "occupied", playerId: defender.connection.playerId,
  });

  await nextChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "next", position: { x: 0, y: 0 },
  });
  const nextWaiting = app.world.cellAt({ x: 0, y: 0 });
  assert.equal(nextWaiting.kind === "challengeWaiting" ? nextWaiting.waitingId : -1, 2);
});

test("active battle leaves release slots for nonconflicting Waiting rosters", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const third = await app.connect();
  const fourth = await app.connect();
  const firstChallenger = await app.connect();
  const secondChallenger = await app.connect();
  await app.coordinator.createDebugBattle(first.connection, [
    first.connection.playerId,
    second.connection.playerId,
    third.connection.playerId,
    fourth.connection.playerId,
  ]);
  await firstChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "first", position: { x: 0, y: 0 },
  });
  await secondChallenger.connection.receive({
    type: "challengeWorldCell", requestId: "second", position: { x: 2, y: 0 },
  });
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengeWaiting");
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "challengeWaiting");

  await first.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengePending");
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "challengeWaiting");
  await second.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "challengePending");
});

test("battle status changes promote Waiting even outside coordinator leave", async (t) => {
  const app = await harness(true, 1);
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const second = await app.connect();
  const third = await app.connect();
  const fourth = await app.connect();
  const challenger = await app.connect();
  await app.coordinator.createDebugBattle(defender.connection, [
    defender.connection.playerId,
    second.connection.playerId,
    third.connection.playerId,
    fourth.connection.playerId,
  ]);
  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 0, y: 0 },
  });
  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengeWaiting");

  const battle = app.battles.get("battle-1");
  assert.notEqual(battle, undefined);
  const participantId = battle?.participantIdForPlayer(defender.connection.playerId);
  assert.notEqual(participantId, undefined);
  if (battle === undefined || participantId === undefined) return;
  await battle.withdraw(participantId);
  assert.equal(battle.snapshot.status.kind, "running");
  await app.coordinator.adminGetWorld();

  assert.equal(app.world.cellAt({ x: 0, y: 0 }).kind, "challengePending");
});

test("challenge identifiers stop at the safe integer boundary without mutation", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  await app.connect();
  const third = await app.connect();
  await app.connect();
  (app.coordinator as unknown as { nextChallengeSequence: number | null })
    .nextChallengeSequence = Number.MAX_SAFE_INTEGER;

  assert.equal(
    await app.coordinator.challengeWorldCell(first.connection, { x: 2, y: 0 }),
    null,
  );
  const last = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(
    last.kind === "challengePending" ? last.challengeId : null,
    `challenge-${Number.MAX_SAFE_INTEGER}`,
  );
  const untouched = app.world.cellAt({ x: 6, y: 0 });

  await assert.rejects(
    app.coordinator.challengeWorldCell(third.connection, { x: 6, y: 0 }),
    /identifier space is exhausted/,
  );
  assert.deepEqual(app.world.cellAt({ x: 6, y: 0 }), untouched);
});
