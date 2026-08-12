import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import type { NetworkClientEvent } from "../../client/src/session/NetworkClient.ts";
import {
  NetworkClient,
  type NetworkWebSocket,
} from "../../client/src/session/NetworkClient.ts";
import type { NetworkBattleSession } from "../../client/src/session/NetworkBattleSession.ts";
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

async function startServer(t: TestContext) {
  const clock = new ManualHostedBattleClock();
  const server = createGridGameServer({ debugEnabled: true, battleClock: clock });
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

  return { clock, connect, server, url };
}

test("real clients discover players, share authoritative battle facts, probe, leave, and disconnect", async (t) => {
  const app = await startServer(t);
  const first = await app.connect();
  const second = await app.connect();

  assert.equal(first.playerId, "player-1");
  assert.equal(second.playerId, "player-2");
  assert.deepEqual(await first.debugGetPlayerIds(), ["player-1", "player-2"]);

  const secondJoin = waitForClientEvent(
    second,
    (event) => event.type === "battleJoined",
    "the invited client to join the battle",
  );
  const firstSession = await first.debugCreateBattle([first.playerId, second.playerId]);
  const secondJoinEvent = await secondJoin;
  assert.equal(secondJoinEvent.type, "battleJoined");
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
    playerId: first.playerId,
    position: { x: 0, y: 0 },
  });
  const expectedIncrement = {
    type: "cellIncremented",
    tick: 0,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", playerId: first.playerId, count: 2 },
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
    (message) => message.type === "cooldownChanged" && message.cooldown.playerId === second.playerId,
    "a later broadcast to establish probe routing order",
  );
  await secondSession.send({
    type: "incrementCell",
    requestId: "increment-2",
    playerId: second.playerId,
    position: { x: 1, y: 0 },
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
      const playerIds = await first.debugGetPlayerIds();
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
    socket.once("message", () => resolve());
    socket.once("error", reject);
  }), "the gateway identity message");

  const closed = withTimeout(new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  }), "the gateway policy close");
  socket.send(JSON.stringify({ type: "not-a-client-message" }));
  assert.deepEqual(await closed, { code: 1008, reason: "invalid message" });
});
