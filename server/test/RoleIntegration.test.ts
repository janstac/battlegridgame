import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import {
  type AdminConnectionServerMessage,
  parseAdminConnectionServerMessage,
  parseNetworkServerMessage,
  type NetworkServerMessage,
} from "@grid-game/shared";
import { WebSocket } from "ws";
import { ADMIN_TOKEN } from "../src/admin/AdminToken.ts";
import {
  createGridGameServer,
  type GridGameServerOptions,
} from "../src/server.ts";

const ASYNC_TIMEOUT_MS = 2_000;

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

class RawSocket {
  readonly socket: WebSocket;
  private readonly values: unknown[] = [];
  private readonly readers: Array<(value: unknown) => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (data, isBinary) => {
      const value = isBinary ? data : JSON.parse(data.toString()) as unknown;
      const reader = this.readers.shift();
      if (reader === undefined) this.values.push(value);
      else reader(value);
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await withTimeout(new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    }), "WebSocket open");
  }

  send(value: unknown): void {
    this.socket.send(typeof value === "string" ? value : JSON.stringify(value));
  }

  async next(): Promise<unknown> {
    const value = this.values.shift();
    if (value !== undefined) return value;
    return await withTimeout(new Promise((resolve) => this.readers.push(resolve)), "WebSocket message");
  }

  async closeResult(): Promise<{ code: number; reason: string }> {
    return await withTimeout(new Promise((resolve) => {
      this.socket.once("close", (code, reason) => resolve({
        code,
        reason: reason.toString(),
      }));
    }), "WebSocket close");
  }
}

async function startServer(t: TestContext, options: GridGameServerOptions = {}) {
  const server = createGridGameServer({
    worldRandom: { next: () => 0 },
    ...options,
  });
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  }), "HTTP server to listen");
  t.after(async () => server.close());
  const address = server.httpServer.address() as AddressInfo;
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const connect = async () => {
    const socket = new RawSocket(url);
    await socket.opened();
    t.after(() => socket.socket.close());
    return socket;
  };
  return { connect, server };
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  await withTimeout((async () => {
    while (!predicate()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  })(), description);
}

test("sockets remain anonymous until they select exactly one role", async (t) => {
  const app = await startServer(t, { playerSessionResumeGraceMs: 0 });
  const player = await app.connect();
  assert.deepEqual(app.server.players.playerIds(), []);
  assert.equal(app.server.world.revision, 0);

  player.send({ type: "connectAsPlayer" });
  const connected = parseNetworkServerMessage(await player.next());
  assert.equal(connected.type, "connected");
  assert.equal(connected.playerId, "player-1");
  assert.ok(connected.resumeToken);
  assert.equal(connected.resumeGraceMs, 0);
  const bootstrap = parseNetworkServerMessage(await player.next());
  assert.equal(bootstrap.type, "worldSnapshot");
  assert.deepEqual(app.server.players.playerIds(), ["player-1"]);

  const admin = await app.connect();
  const beforeAdminClose = app.server.world.revision;
  admin.send({ type: "connectAsAdmin", token: ADMIN_TOKEN });
  assert.deepEqual(parseAdminConnectionServerMessage(await admin.next()), {
    type: "connectedAsAdmin",
  });
  assert.deepEqual(app.server.players.playerIds(), ["player-1"]);

  admin.send({ type: "adminListPlayers", requestId: "players" });
  assert.deepEqual(parseAdminConnectionServerMessage(await admin.next()), {
    type: "adminPlayers",
    requestId: "players",
    playerIds: ["player-1"],
  });

  const adminClosed = admin.closeResult();
  admin.socket.close();
  await adminClosed;
  assert.deepEqual(app.server.players.playerIds(), ["player-1"]);
  assert.equal(app.server.world.revision, beforeAdminClose);

  const playerClosed = player.closeResult();
  player.socket.close();
  await playerClosed;
  await waitFor(() => app.server.players.playerIds().length === 0, "player cleanup");
});

test("authenticated admin messages use the typed async handler", async (t) => {
  const received: string[] = [];
  const app = await startServer(t, {
    adminMessageHandler: async (message, output) => {
      received.push(message.type);
      await Promise.resolve();
      output({
        type: "adminPlayers",
        requestId: message.requestId,
        playerIds: [],
      });
    },
  });
  const admin = await app.connect();
  admin.send({ type: "connectAsAdmin", token: ADMIN_TOKEN });
  assert.equal((await admin.next() as AdminConnectionServerMessage).type, "connectedAsAdmin");
  admin.send({ type: "adminListPlayers", requestId: "list-1" });
  assert.deepEqual(parseAdminConnectionServerMessage(await admin.next()), {
    type: "adminPlayers",
    requestId: "list-1",
    playerIds: [],
  });
  assert.deepEqual(received, ["adminListPlayers"]);
});

test("gateway rejects malformed admin handler output before serialization", async (t) => {
  const reported: unknown[] = [];
  const app = await startServer(t, {
    reportWebSocketError: (error) => reported.push(error),
    adminMessageHandler: (message, output) => {
      // Variables with extra fields are structurally assignable in TypeScript;
      // the gateway's runtime TypeBox parser must reject this before writing it.
      const malformed = {
        type: "adminPlayers" as const,
        requestId: message.requestId,
        playerIds: [],
        extra: true,
      };
      output(malformed);
    },
  });
  const admin = await app.connect();
  admin.send({ type: "connectAsAdmin", token: ADMIN_TOKEN });
  assert.equal(
    (await admin.next() as AdminConnectionServerMessage).type,
    "connectedAsAdmin",
  );

  let receivedFrame = false;
  admin.socket.once("message", () => { receivedFrame = true; });
  const closed = admin.closeResult();
  admin.send({ type: "adminListPlayers", requestId: "list-1" });
  const result = await closed;

  assert.equal(result.code, 1011);
  assert.equal(result.reason, "server error");
  assert.equal(receivedFrame, false);
  assert.equal(reported.length, 1);
});

type RejectionCase = Readonly<{
  name: string;
  authenticate?: "player" | "admin";
  value: unknown;
  reason?: string;
}>;

const rejectionCases: readonly RejectionCase[] = [
  { name: "invalid JSON", value: "{" },
  { name: "player message before role selection", value: { type: "requestWorldSnapshot" } },
  {
    name: "wrong admin token",
    value: { type: "connectAsAdmin", token: "wrong-token" },
    reason: "authentication failed",
  },
  { name: "second player role selection", authenticate: "player", value: { type: "connectAsPlayer" } },
  {
    name: "admin role switch from player",
    authenticate: "player",
    value: { type: "connectAsAdmin", token: ADMIN_TOKEN },
  },
  {
    name: "admin message from player",
    authenticate: "player",
    value: { type: "adminListPlayers", requestId: "list" },
  },
  {
    name: "second admin role selection",
    authenticate: "admin",
    value: { type: "connectAsAdmin", token: ADMIN_TOKEN },
  },
  {
    name: "player role switch from admin",
    authenticate: "admin",
    value: { type: "connectAsPlayer" },
  },
  {
    name: "player message from admin",
    authenticate: "admin",
    value: { type: "requestWorldSnapshot" },
  },
];

for (const rejection of rejectionCases) {
  test(`gateway rejects ${rejection.name} with a policy close`, async (t) => {
    const app = await startServer(t);
    const client = await app.connect();
    if (rejection.authenticate !== undefined) {
      client.send(rejection.authenticate === "player"
        ? { type: "connectAsPlayer" }
        : { type: "connectAsAdmin", token: ADMIN_TOKEN });
      await client.next();
    }

    const closed = client.closeResult();
    client.send(rejection.value);
    const result = await closed;
    assert.equal(result.code, 1008);
    assert.equal(result.reason, rejection.reason ?? "invalid message");
    assert.equal(result.reason.includes(ADMIN_TOKEN), false);
  });
}
