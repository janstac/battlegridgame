import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import type { NetworkClientEvent } from "../../client/src/session/NetworkClient.ts";
import {
  NetworkClient,
  type NetworkWebSocket,
} from "../../client/src/session/NetworkClient.ts";
import type { NetworkBattleSession } from "../../client/src/session/NetworkBattleSession.ts";
import { WorldCommandRejectedError } from "../../client/src/session/NetworkWorldSession.ts";
import type { ServerMessage } from "@grid-game/shared";
import { WebSocket } from "ws";
import { createGridGameServer } from "../src/server.ts";

const ASYNC_TIMEOUT_MS = 2_000;

class ManualHostedBattleClock {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 0;

  setInterval(callback: () => void, _intervalMs: number): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  runTick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

class ManualChallengeClock {
  private readonly callbacks = new Map<number, { callback(): void; at: number }>();
  private nextHandle = 0;
  private time = 1_000;

  now(): number { return this.time; }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, { callback, at: this.time + delayMs });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  advance(ms: number): void {
    this.time += ms;
    for (const [handle, entry] of [...this.callbacks]) {
      if (entry.at <= this.time) {
        this.callbacks.delete(handle);
        entry.callback();
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, description: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}`)),
      ASYNC_TIMEOUT_MS,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function waitForClientEvent(
  client: NetworkClient,
  predicate: (event: NetworkClientEvent) => boolean,
  description: string,
): Promise<NetworkClientEvent> {
  return withTimeout(new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    unsubscribe = client.subscribe((event) => {
      if (!predicate(event)) return;
      settled = true;
      unsubscribe();
      resolve(event);
    });
    if (settled) unsubscribe();
  }), description);
}

function waitForSessionMessage(
  session: NetworkBattleSession,
  predicate: (message: ServerMessage) => boolean,
  description: string,
): Promise<ServerMessage> {
  return withTimeout(new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    unsubscribe = session.subscribe((message) => {
      if (!predicate(message)) return;
      settled = true;
      unsubscribe();
      resolve(message);
    });
    if (settled) unsubscribe();
  }), description);
}

function waitForChallengeability(
  client: NetworkClient,
  challengeable: boolean,
): Promise<void> {
  if (client.world.state.getSnapshot().challengeable === challengeable) {
    return Promise.resolve();
  }
  return withTimeout(new Promise<void>((resolve) => {
    const unsubscribe = client.world.state.subscribe(() => {
      if (client.world.state.getSnapshot().challengeable !== challengeable) return;
      unsubscribe();
      resolve();
    });
  }), `challengeable=${challengeable}`);
}

async function startServer(t: TestContext, maxConcurrentBattlesPerPlayer?: number) {
  const clock = new ManualHostedBattleClock();
  const challengeClock = new ManualChallengeClock();
  const server = createGridGameServer({
    debugEnabled: true,
    battleClock: clock,
    challengeClock,
    worldRandom: { next: () => 0 },
    ...(maxConcurrentBattlesPerPlayer === undefined
      ? {}
      : { maxConcurrentBattlesPerPlayer }),
  });
  const clients = new Set<NetworkClient>();
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  }), "HTTP server to listen");

  t.after(async () => {
    await Promise.all([...clients].map((client) => client.close()));
    await server.close();
  });

  const address = server.httpServer.address() as AddressInfo;
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const connect = async (): Promise<NetworkClient> => {
    const client = await withTimeout(NetworkClient.connect(url, {
      webSocketFactory: (target) => new WebSocket(target) as NetworkWebSocket,
    }), "WebSocket identity handshake");
    clients.add(client);
    return client;
  };

  return { clock, challengeClock, connect, server, url };
}

test("real clients discover players, share authoritative battle facts, probe, leave, and disconnect", async (t) => {
  const app = await startServer(t);
  const first = await app.connect();
  const second = await app.connect();

  assert.equal(first.playerId, "player-1");
  assert.equal(second.playerId, "player-2");
  assert.deepEqual(app.server.players.playerIds(), ["player-1", "player-2"]);

  const firstJoin = waitForClientEvent(
    first,
    (event) => event.type === "battleJoined",
    "the creating client to join the battle",
  );
  const secondJoin = waitForClientEvent(
    second,
    (event) => event.type === "battleJoined",
    "the invited client to join the battle",
  );
  const requester = app.server.players.get(first.playerId);
  assert.ok(requester);
  assert.equal(await app.server.coordinator.createDebugBattle(
    requester,
    [first.playerId, second.playerId],
  ), null);
  const [firstJoinEvent, secondJoinEvent] = await Promise.all([firstJoin, secondJoin]);
  assert.equal(firstJoinEvent.type, "battleJoined");
  assert.equal(secondJoinEvent.type, "battleJoined");
  const firstSession = firstJoinEvent.session;
  const secondSession = secondJoinEvent.session;
  assert.equal(firstSession.battleId, "battle-1");
  assert.equal(secondSession.battleId, firstSession.battleId);
  assert.deepEqual(secondSession.initialSnapshot, firstSession.initialSnapshot);

  const firstIncrement = waitForSessionMessage(
    firstSession,
    (message) => message.type === "cellIncremented",
    "the creating client to receive an accepted update",
  );
  const secondIncrement = waitForSessionMessage(
    secondSession,
    (message) => message.type === "cellIncremented",
    "the invited client to receive an accepted update",
  );
  await firstSession.send({
    type: "incrementCell",
    requestId: "increment-1",
    position: { x: 1, y: 1 },
  });
  const expectedIncrement = {
    type: "cellIncremented",
    tick: 0,
    position: { x: 1, y: 1 },
    cell: { kind: "occupied", participantId: 0, count: 2 },
    source: "command",
  };
  assert.deepEqual(await firstIncrement, expectedIncrement);
  assert.deepEqual(await secondIncrement, expectedIncrement);

  const messagesSeenBySecond: ServerMessage[] = [];
  const unsubscribeSecond = secondSession.subscribe((message) => messagesSeenBySecond.push(message));
  const probeResult = waitForSessionMessage(
    firstSession,
    (message) => message.type === "tickProbeResult" && message.probeId === "probe-1",
    "the requesting client to receive its probe result",
  );
  await firstSession.send({ type: "tickProbe", probeId: "probe-1" });
  assert.deepEqual(await probeResult, { type: "tickProbeResult", probeId: "probe-1", tick: 0 });

  const secondCooldown = waitForSessionMessage(
    secondSession,
    (message) => message.type === "cooldownChanged" && message.cooldown.participantId === 1,
    "a later broadcast to establish probe routing order",
  );
  await secondSession.send({
    type: "incrementCell",
    requestId: "increment-2",
    position: { x: 5, y: 1 },
  });
  await secondCooldown;
  unsubscribeSecond();
  assert.equal(
    messagesSeenBySecond.some(
      (message) => message.type === "tickProbeResult" && message.probeId === "probe-1",
    ),
    false,
  );

  await firstSession.close();
  assert.equal(first.getSession(firstSession.battleId), undefined);
  assert.equal(second.getSession(secondSession.battleId), secondSession);

  await second.close();
  await withTimeout((async () => {
    for (;;) {
      const playerIds = app.server.players.playerIds();
      if (playerIds.length === 1) return playerIds;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  })(), "the disconnected player to leave discovery").then((playerIds) => {
    assert.deepEqual(playerIds, [first.playerId]);
  });

  // The injected clock never advances unless the test explicitly requests it.
  app.clock.runTick();
});

test("gateway rejects malformed client messages with a policy close", async (t) => {
  const app = await startServer(t);
  const socket = new WebSocket(app.url);
  t.after(() => socket.close());

  await withTimeout(new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  }), "the raw WebSocket to open");
  const identified = withTimeout(new Promise<void>((resolve, reject) => {
    socket.once("message", () => resolve());
    socket.once("error", reject);
  }), "the gateway identity message");
  socket.send(JSON.stringify({ type: "connectAsPlayer" }));
  await identified;

  const closed = withTimeout(new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  }), "the gateway policy close");
  socket.send(JSON.stringify({ type: "not-a-client-message" }));
  assert.deepEqual(await closed, { code: 1008, reason: "invalid message" });
});

test("real clients disable challenges at capacity and re-enable them after release", async (t) => {
  const app = await startServer(t, 1);
  const first = await app.connect();
  const second = await app.connect();
  await Promise.all([first.world.ready, second.world.ready]);
  assert.equal(first.world.state.getSnapshot().challengeable, true);

  const firstJoined = waitForClientEvent(
    first,
    (event) => event.type === "battleJoined",
    "capacity-limited battle membership",
  );
  const firstConnection = app.server.players.get(first.playerId);
  assert.ok(firstConnection);
  assert.equal(await app.server.coordinator.createDebugBattle(firstConnection, [
    first.playerId,
    second.playerId,
  ]), null);
  const joined = await firstJoined;
  assert.equal(joined.type, "battleJoined");
  await waitForChallengeability(first, false);

  await joined.session.close();
  await waitForChallengeability(first, true);
});

test("real clients observe the World while only challenge participants receive its battle", async (t) => {
  const app = await startServer(t);
  const challenger = await app.connect();
  const defender = await app.connect();
  const observer = await app.connect();
  await Promise.all([
    challenger.world.ready,
    defender.world.ready,
    observer.world.ready,
  ]);

  assert.equal(challenger.world.state.getSnapshot().snapshot?.grid.width, 10);
  await challenger.world.challengeCell({ x: 2, y: 0 });
  const pending = challenger.world.state.getSnapshot().snapshot?.grid.cells[2];
  assert.equal(pending?.kind, "challengePending");
  if (pending?.kind !== "challengePending") return;
  assert.deepEqual(pending.participantIds, [defender.playerId, challenger.playerId]);

  const challengerJoin = waitForClientEvent(
    challenger,
    (event) => event.type === "battleJoined",
    "challenger battle session",
  );
  const defenderJoin = waitForClientEvent(
    defender,
    (event) => event.type === "battleJoined",
    "defender battle session",
  );
  app.challengeClock.advance(5_000);
  const [challengerEvent, defenderEvent] = await Promise.all([
    challengerJoin,
    defenderJoin,
  ]);
  assert.equal(challengerEvent.type, "battleJoined");
  assert.equal(defenderEvent.type, "battleJoined");
  assert.equal(observer.getSessions().length, 0);
  assert.equal(observer.world.state.getSnapshot().snapshot?.grid.cells[2]?.kind, "battle");

  const defenderLeft = waitForClientEvent(
    defender,
    (event) => event.type === "battleLeft",
    "winner session disposal",
  );
  await challengerEvent.session.close();
  await defenderLeft;
  assert.equal(defender.getSessions().length, 0);
  assert.deepEqual(
    defender.world.state.getSnapshot().snapshot?.grid.cells[2],
    { kind: "occupied", playerId: defender.playerId },
  );
  assert.equal(app.server.battles.get(challengerEvent.session.battleId), undefined);
});

test("real clients receive Waiting cells and structured capacity rejection", async (t) => {
  const app = await startServer(t, 1);
  const defender = await app.connect();
  const opponent = await app.connect();
  const challenger = await app.connect();
  await Promise.all([defender.world.ready, opponent.world.ready, challenger.world.ready]);
  const defenderConnection = app.server.players.get(defender.playerId);
  assert.ok(defenderConnection);
  assert.equal(await app.server.coordinator.createDebugBattle(defenderConnection, [
    defender.playerId, opponent.playerId,
  ]), null);

  await challenger.world.challengeCell({ x: 0, y: 0 });
  assert.deepEqual(
    challenger.world.state.getSnapshot().snapshot?.grid.cells[0],
    {
      kind: "challengeWaiting",
      challengeId: "challenge-1",
      waitingId: 1,
      defenderId: defender.playerId,
      participantIds: [defender.playerId, challenger.playerId],
    },
  );
  await assert.rejects(
    defender.world.challengeCell({ x: 4, y: 0 }),
    (error: unknown) => error instanceof WorldCommandRejectedError
      && error.reason === "battleLimitReached",
  );
});
