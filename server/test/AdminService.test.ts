import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkServerMessage, WorldCell } from "@grid-game/shared";
import { AdminService } from "../src/admin/AdminService.ts";
import { ClientConnection } from "../src/application/ClientConnection.ts";
import { PlayerDirectory } from "../src/application/PlayerDirectory.ts";
import { WorldCoordinator } from "../src/application/WorldCoordinator.ts";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import { StandardBattleFactory } from "../src/game/StandardBattleFactory.ts";
import type { HostedBattleClock } from "../src/game/HostedBattle.ts";
import type { PendingChallengeClock } from "../src/world/PendingChallenge.ts";
import { World } from "../src/world/World.ts";

const battleClock: HostedBattleClock = {
  setInterval: () => 1,
  clearInterval: () => undefined,
};

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

async function harness(options: Readonly<{
  maxConcurrentBattlesPerPlayer?: number;
}> = {}) {
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const world = new World({ random: { next: () => 0 } });
  const challengeClock = new ManualChallengeClock();
  const coordinator = new WorldCoordinator(
    players,
    battles,
    world,
    new StandardBattleFactory(battleClock),
    {
      debugEnabled: true,
      challengeClock,
      ...(options.maxConcurrentBattlesPerPlayer === undefined
        ? {}
        : {
            maxConcurrentBattlesPerPlayer:
              options.maxConcurrentBattlesPerPlayer,
          }),
    },
  );
  const admin = new AdminService(coordinator);
  const connect = async () => {
    const messages: NetworkServerMessage[] = [];
    const connection = players.register((playerId) => new ClientConnection(
      playerId,
      coordinator,
      (message) => messages.push(message),
      () => undefined,
    ));
    await connection.open();
    return { connection, messages };
  };
  return { players, battles, world, challengeClock, coordinator, admin, connect };
}

test("admin inspection returns deterministic independent server snapshots", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();

  const players = await app.admin.dispatch({
    type: "adminListPlayers", requestId: "players",
  });
  assert.deepEqual(players, {
    type: "adminPlayers",
    requestId: "players",
    playerIds: ["player-1", "player-2"],
  });

  const world = await app.admin.dispatch({
    type: "adminGetWorld", requestId: "world",
  });
  assert.equal(world.type, "adminWorld");
  if (world.type !== "adminWorld") return;
  assert.deepEqual(world.snapshot, app.world.snapshot());
  world.snapshot.grid.cells[0] = { kind: "unoccupied" };
  assert.notDeepEqual(world.snapshot, app.world.snapshot());

  const started = await app.admin.dispatch({
    type: "adminStartBattle",
    requestId: "start",
    playerIds: [second.connection.playerId, first.connection.playerId],
  });
  assert.equal(started.type, "adminBattleStarted");

  const listed = await app.admin.dispatch({
    type: "adminListBattles", requestId: "battles",
  });
  assert.equal(listed.type, "adminBattles");
  if (started.type !== "adminBattleStarted" || listed.type !== "adminBattles") return;
  assert.deepEqual(listed.battles, [started.battle]);
  assert.equal(started.battle.worldPosition, null);
  assert.deepEqual(started.battle.roster.map(({ playerId }) => playerId), [
    "player-2", "player-1",
  ]);
});

test("admin battle start validates rosters and preserves simultaneous memberships", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();

  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");

  assert.deepEqual(await app.admin.dispatch({
    type: "adminStartBattle",
    requestId: "unknown",
    playerIds: [first.connection.playerId, "player-404"],
  }), {
    type: "adminError",
    requestId: "unknown",
    code: "unknownPlayer",
    message: "Every battle participant must be connected",
  });

  const duplicate = await app.coordinator.adminStartBattle([
    first.connection.playerId,
    first.connection.playerId,
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, "invalidRoster");

  const roster = [first.connection.playerId, second.connection.playerId];
  const firstStart = await app.admin.dispatch({
    type: "adminStartBattle", requestId: "first", playerIds: roster,
  });
  const secondStart = await app.admin.dispatch({
    type: "adminStartBattle", requestId: "second", playerIds: roster,
  });
  assert.equal(firstStart.type, "adminBattleStarted");
  assert.equal(secondStart.type, "adminBattleStarted");
  assert.equal(app.battles.membershipsForPlayer(first.connection.playerId).length, 2);
  assert.equal(first.messages.filter(({ type }) => type === "battleJoined").length, 2);
  assert.equal(second.messages.filter(({ type }) => type === "battleJoined").length, 2);
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), pending);
});

test("admin battle start rejects players disconnected before serialized execution", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await second.connection.close();

  const response = await app.admin.dispatch({
    type: "adminStartBattle",
    requestId: "closed",
    playerIds: [first.connection.playerId, second.connection.playerId],
  });
  assert.equal(response.type, "adminError");
  if (response.type === "adminError") assert.equal(response.code, "unknownPlayer");
  assert.equal(app.battles.entries().length, 0);
});

test("admin and debug battle starts reject capped rosters atomically", async (t) => {
  const app = await harness({ maxConcurrentBattlesPerPlayer: 1 });
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const roster = [first.connection.playerId, second.connection.playerId];

  const started = await app.admin.dispatch({
    type: "adminStartBattle", requestId: "first", playerIds: roster,
  });
  assert.equal(started.type, "adminBattleStarted");
  const worldBefore = app.world.snapshot();
  const firstMessagesBefore = first.messages.length;
  const secondMessagesBefore = second.messages.length;

  assert.deepEqual(await app.admin.dispatch({
    type: "adminStartBattle", requestId: "capped", playerIds: roster,
  }), {
    type: "adminError",
    requestId: "capped",
    code: "battleLimitReached",
    message: "One or more battle participants have reached the concurrent battle limit",
  });
  assert.equal(
    await app.coordinator.createDebugBattle(first.connection, roster),
    "battleLimitReached",
  );
  assert.equal(app.battles.entries().length, 1);
  assert.equal(first.messages.length, firstMessagesBefore);
  assert.equal(second.messages.length, secondMessagesBefore);
  assert.deepEqual(app.world.snapshot(), worldBefore);

  await first.connection.receive({
    type: "challengeWorldCell", requestId: "later-capacity", position: { x: 2, y: 0 },
  });
  assert.deepEqual(first.messages.at(-1), {
    type: "worldCommandRejected",
    requestId: "later-capacity",
    reason: "battleLimitReached",
  });
});

test("admin world replacement commits one atomic ordinary-cell delta", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const deltas: unknown[] = [];
  const unsubscribe = app.world.subscribe((delta) => deltas.push(delta));
  t.after(unsubscribe);
  const revision = app.world.revision;

  const response = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "replace",
    changes: [
      {
        position: { x: 0, y: 0 },
        expected: { kind: "occupied", playerId: first.connection.playerId },
        next: { kind: "unoccupied" },
      },
      {
        position: { x: 1, y: 0 },
        expected: { kind: "occupied", playerId: first.connection.playerId },
        next: { kind: "occupied", playerId: second.connection.playerId },
      },
    ],
  });
  assert.equal(response.type, "adminWorldCellsReplaced");
  if (response.type !== "adminWorldCellsReplaced") return;
  assert.equal(response.revision, revision + 1);
  assert.equal(deltas.length, 1);
  assert.deepEqual(response.changes, [
    { position: { x: 0, y: 0 }, cell: { kind: "unoccupied" } },
    {
      position: { x: 1, y: 0 },
      cell: { kind: "occupied", playerId: second.connection.playerId },
    },
  ]);
});

test("admin world replacement rejects stale duplicate invalid and disconnected inputs atomically", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await second.connection.close();
  const before = app.world.snapshot();

  const stale = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "stale",
    changes: [{
      position: { x: 0, y: 0 },
      expected: { kind: "occupied", playerId: "player-404" },
      next: { kind: "unoccupied" },
    }],
  });
  assert.equal(stale.type === "adminError" ? stale.code : null, "conflict");

  const duplicate = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "duplicate",
    changes: [
      {
        position: { x: 0, y: 0 },
        expected: app.world.cellAt({ x: 0, y: 0 }),
        next: { kind: "unoccupied" },
      },
      {
        position: { x: 0, y: 0 },
        expected: app.world.cellAt({ x: 0, y: 0 }),
        next: { kind: "unoccupied" },
      },
    ],
  });
  assert.equal(
    duplicate.type === "adminError" ? duplicate.code : null,
    "invalidRequest",
  );

  const invalid = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "invalid",
    changes: [{
      position: { x: app.world.width, y: 0 },
      expected: { kind: "unoccupied" },
      next: { kind: "unoccupied" },
    }],
  });
  assert.equal(invalid.type === "adminError" ? invalid.code : null, "invalidRequest");

  const disconnected = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "disconnected",
    changes: [{
      position: { x: 0, y: 0 },
      expected: app.world.cellAt({ x: 0, y: 0 }),
      next: { kind: "occupied", playerId: second.connection.playerId },
    }],
  });
  assert.equal(
    disconnected.type === "adminError" ? disconnected.code : null,
    "unknownPlayer",
  );
  assert.deepEqual(app.world.snapshot(), before);
});

test("admin replacement fully compares and silently retires a challenge", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");
  if (pending.kind !== "challengePending") return;
  const revision = app.world.revision;

  const stale = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "stale-challenge",
    changes: [{
      position: { x: 2, y: 0 },
      expected: { ...pending, closesAt: pending.closesAt + 1 },
      next: { kind: "unoccupied" },
    }],
  });
  assert.equal(stale.type === "adminError" ? stale.code : null, "conflict");
  assert.equal(app.world.revision, revision);

  const replacing = app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "cancel-challenge",
    changes: [{
      position: { x: 2, y: 0 },
      expected: pending,
      next: { kind: "occupied", playerId: first.connection.playerId },
    }],
  });
  app.challengeClock.advance(10_000);
  const replaced = await replacing;
  assert.equal(replaced.type, "adminWorldCellsReplaced");
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), {
    kind: "occupied", playerId: first.connection.playerId,
  });
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.revision, revision + 1);
  assert.equal(second.messages.some(({ type }) => type === "battleJoined"), false);
});

test("admin replacement fully compares and silently retires a Waiting challenge", async (t) => {
  const app = await harness({ maxConcurrentBattlesPerPlayer: 1 });
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const opponent = await app.connect();
  const challenger = await app.connect();
  const roster = [defender.connection.playerId, opponent.connection.playerId];
  assert.equal(await app.coordinator.createDebugBattle(
    defender.connection,
    roster,
  ), null);
  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 0, y: 0 },
  });
  const waiting = app.world.cellAt({ x: 0, y: 0 });
  assert.equal(waiting.kind, "challengeWaiting");
  if (waiting.kind !== "challengeWaiting") return;
  const revision = app.world.revision;
  const messageCounts = [
    defender.messages.length,
    opponent.messages.length,
    challenger.messages.length,
  ];

  const stale = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "stale-waiting",
    changes: [{
      position: { x: 0, y: 0 },
      expected: { ...waiting, waitingId: waiting.waitingId + 1 },
      next: { kind: "unoccupied" },
    }],
  });
  assert.equal(stale.type === "adminError" ? stale.code : null, "conflict");
  assert.equal(app.world.revision, revision);

  const replaced = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "cancel-waiting",
    changes: [{
      position: { x: 0, y: 0 },
      expected: waiting,
      next: { kind: "occupied", playerId: challenger.connection.playerId },
    }],
  });
  assert.equal(replaced.type, "adminWorldCellsReplaced");
  assert.deepEqual(app.world.cellAt({ x: 0, y: 0 }), {
    kind: "occupied", playerId: challenger.connection.playerId,
  });
  assert.equal(app.world.revision, revision + 1);
  for (const [client, count] of [
    [defender, messageCounts[0]],
    [opponent, messageCounts[1]],
    [challenger, messageCounts[2]],
  ] as const) {
    assert.deepEqual(client.messages.slice(count).map(({ type }) => type), ["worldDelta"]);
  }

  await defender.connection.receive({ type: "leaveBattle", battleId: "battle-1" });
  await app.coordinator.adminGetWorld();
  assert.deepEqual(app.world.cellAt({ x: 0, y: 0 }), {
    kind: "occupied", playerId: challenger.connection.playerId,
  });
});

test("admin replacement cancels only the targeted world battle after its one delta", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  const detached = await app.admin.dispatch({
    type: "adminStartBattle",
    requestId: "detached",
    playerIds: [first.connection.playerId, second.connection.playerId],
  });
  assert.equal(detached.type, "adminBattleStarted");
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  const battleCell = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(battleCell.kind, "battle");
  if (battleCell.kind !== "battle" || detached.type !== "adminBattleStarted") return;
  const firstMessageCount = first.messages.length;
  const secondMessageCount = second.messages.length;
  const revision = app.world.revision;

  const response = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "cancel-battle",
    changes: [
      {
        position: { x: 2, y: 0 },
        expected: battleCell,
        next: { kind: "unoccupied" },
      },
      {
        position: { x: 0, y: 0 },
        expected: app.world.cellAt({ x: 0, y: 0 }),
        next: { kind: "occupied", playerId: second.connection.playerId },
      },
    ],
  });
  assert.equal(response.type, "adminWorldCellsReplaced");
  assert.equal(app.world.revision, revision + 1);
  assert.equal(app.battles.get(battleCell.battleId), undefined);
  assert.notEqual(app.battles.get(detached.battle.battleId), undefined);
  assert.equal(app.battles.membershipsForPlayer(first.connection.playerId).length, 1);

  for (const messages of [
    first.messages.slice(firstMessageCount),
    second.messages.slice(secondMessageCount),
  ]) {
    assert.deepEqual(messages.map(({ type }) => type), ["worldDelta", "battleLeft"]);
    assert.equal(messages.filter(
      (message) => message.type === "battleLeft" && message.battleId === battleCell.battleId,
    ).length, 1);
  }
});

test("admin batch promotion starts only after replacement commit and battle-left delivery", async (t) => {
  const app = await harness({ maxConcurrentBattlesPerPlayer: 1 });
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const defender = await app.connect();
  const opponent = await app.connect();
  const challenger = await app.connect();
  await opponent.connection.receive({
    type: "challengeWorldCell", requestId: "battle", position: { x: 0, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  const battleCell = app.world.cellAt({ x: 0, y: 0 });
  assert.equal(battleCell.kind, "battle");
  if (battleCell.kind !== "battle") return;

  await challenger.connection.receive({
    type: "challengeWorldCell", requestId: "waiting", position: { x: 1, y: 0 },
  });
  const waitingCell = app.world.cellAt({ x: 1, y: 0 });
  assert.equal(waitingCell.kind, "challengeWaiting");
  if (waitingCell.kind !== "challengeWaiting") return;
  const revision = app.world.revision;
  const observedWaitingKinds: WorldCell["kind"][] = [];
  const deltas: Array<Readonly<{ revision: number; changeCount: number }>> = [];
  const unsubscribe = app.world.subscribe((delta) => {
    deltas.push({ revision: delta.revision, changeCount: delta.changes.length });
    observedWaitingKinds.push(app.world.cellAt({ x: 1, y: 0 }).kind);
  });
  t.after(unsubscribe);
  const messageCounts = [
    defender.messages.length,
    opponent.messages.length,
    challenger.messages.length,
  ];

  const response = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "replace-and-promote",
    changes: [
      {
        position: { x: 0, y: 0 }, expected: battleCell,
        next: { kind: "unoccupied" },
      },
      {
        position: { x: 4, y: 0 },
        expected: app.world.cellAt({ x: 4, y: 0 }),
        next: { kind: "occupied", playerId: opponent.connection.playerId },
      },
    ],
  });
  assert.equal(response.type, "adminWorldCellsReplaced");
  if (response.type !== "adminWorldCellsReplaced") return;
  assert.equal(response.revision, revision + 1);
  assert.deepEqual(deltas, [
    { revision: revision + 1, changeCount: 2 },
    { revision: revision + 2, changeCount: 1 },
  ]);
  assert.deepEqual(observedWaitingKinds, ["challengeWaiting", "challengePending"]);
  assert.equal(app.world.cellAt({ x: 1, y: 0 }).kind, "challengePending");
  assert.deepEqual(
    defender.messages.slice(messageCounts[0]).map(({ type }) => type),
    ["worldDelta", "battleLeft", "worldDelta"],
  );
  assert.deepEqual(
    opponent.messages.slice(messageCounts[1]).map(({ type }) => type),
    ["worldDelta", "battleLeft", "worldDelta"],
  );
  assert.deepEqual(
    challenger.messages.slice(messageCounts[2]).map(({ type }) => type),
    ["worldDelta", "worldDelta"],
  );
});

test("admin replacement preflights every lifecycle before cancelling any", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  const pending = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(pending.kind, "challengePending");
  if (pending.kind !== "challengePending") return;
  app.world.replaceCell(
    { x: 4, y: 0 },
    { kind: "unoccupied" },
    { kind: "battle", battleId: "battle-missing", playerIds: ["player-1", "player-2"] },
  );
  const missing = app.world.cellAt({ x: 4, y: 0 });
  const revision = app.world.revision;

  const response = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "preflight",
    changes: [
      { position: { x: 2, y: 0 }, expected: pending, next: { kind: "unoccupied" } },
      { position: { x: 4, y: 0 }, expected: missing, next: { kind: "unoccupied" } },
    ],
  });
  assert.equal(
    response.type === "adminError" ? response.code : null,
    "lifecycleNotFound",
  );
  assert.equal(app.world.revision, revision);
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.cellAt({ x: 2, y: 0 }).kind, "battle");
});

test("admin replacement cancels multiple challenge runtimes in one revision", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  await app.connect();
  await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "first-challenge",
    position: { x: 2, y: 0 },
  });
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "second-challenge",
    position: { x: 4, y: 0 },
  });
  const firstPending = app.world.cellAt({ x: 2, y: 0 });
  const secondPending = app.world.cellAt({ x: 4, y: 0 });
  assert.equal(firstPending.kind, "challengePending");
  assert.equal(secondPending.kind, "challengePending");
  const revision = app.world.revision;

  const response = await app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "cancel-both",
    changes: [
      {
        position: { x: 2, y: 0 }, expected: firstPending,
        next: { kind: "unoccupied" },
      },
      {
        position: { x: 4, y: 0 }, expected: secondPending,
        next: { kind: "unoccupied" },
      },
    ],
  });
  assert.equal(response.type, "adminWorldCellsReplaced");
  assert.equal(app.world.revision, revision + 1);
  app.challengeClock.advance(10_000);
  await app.coordinator.adminGetWorld();
  assert.equal(app.world.revision, revision + 1);
});

test("queued terminal resolution becomes a no-op after admin battle cancellation", async (t) => {
  const app = await harness();
  t.after(async () => { await app.coordinator.dispose(); await app.battles.dispose(); });
  const first = await app.connect();
  const second = await app.connect();
  await first.connection.receive({
    type: "challengeWorldCell",
    requestId: "challenge",
    position: { x: 2, y: 0 },
  });
  app.challengeClock.advance(5_000);
  await app.coordinator.adminGetWorld();
  const cell = app.world.cellAt({ x: 2, y: 0 });
  assert.equal(cell.kind, "battle");
  if (cell.kind !== "battle") return;
  const battle = app.battles.get(cell.battleId);
  assert.notEqual(battle, undefined);
  if (battle === undefined) return;
  const participantId = battle.participantIdForPlayer(first.connection.playerId);
  assert.notEqual(participantId, undefined);
  if (participantId === undefined) return;
  const revision = app.world.revision;
  const firstLeftCount = first.messages.filter(({ type }) => type === "battleLeft").length;
  const secondLeftCount = second.messages.filter(({ type }) => type === "battleLeft").length;

  const withdrawing = battle.withdraw(participantId);
  const replacing = app.admin.dispatch({
    type: "adminReplaceWorldCells",
    requestId: "replace-racing-battle",
    changes: [{
      position: { x: 2, y: 0 },
      expected: cell,
      next: { kind: "unoccupied" },
    }],
  });
  await Promise.all([withdrawing, replacing]);
  await app.coordinator.adminGetWorld();

  assert.equal(app.world.revision, revision + 1);
  assert.deepEqual(app.world.cellAt({ x: 2, y: 0 }), { kind: "unoccupied" });
  assert.equal(
    first.messages.filter(({ type }) => type === "battleLeft").length,
    firstLeftCount + 1,
  );
  assert.equal(
    second.messages.filter(({ type }) => type === "battleLeft").length,
    secondLeftCount + 1,
  );
});
