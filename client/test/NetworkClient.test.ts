import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnonymousNetworkClientMessage,
  NetworkClientMessage,
  NetworkServerMessage,
} from "@grid-game/shared";
import {
  NetworkClient,
  ResumeRejectedError,
  type NetworkClientEvent,
  type NetworkWebSocket,
} from "../src/session/NetworkClient.ts";
import { loadFreshResumeSession } from "../src/session/ResumeTokenStore.ts";
import { createBattleSnapshot } from "./helpers.ts";

const ROSTER = [
  { participantId: 0, playerId: "player-1", status: "active" as const },
  { participantId: 1, playerId: "player-2", status: "active" as const },
] as const;

function worldSnapshot(revision = 0) {
  return {
    revision,
    grid: {
      width: 2,
      height: 1,
      cells: [
        { kind: "occupied" as const, playerId: "player-1" },
        { kind: "unoccupied" as const },
      ],
    },
  };
}

class FakeSocket implements NetworkWebSocket {
  readyState = 0;
  readonly sent: Array<AnonymousNetworkClientMessage | NetworkClientMessage> = [];
  closeCount = 0;
  closedWith: Readonly<{ code?: number; reason?: string }> | null = null;
  private readonly openListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];
  private readonly closeListeners: Array<(event: Readonly<{ code: number; reason: string; wasClean: boolean }>) => void> = [];
  private readonly errorListeners: Array<() => void> = [];

  addEventListener(type: "open" | "message" | "close" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: Readonly<{ code: number; reason: string; wasClean: boolean }>) => void) | (() => void)): void {
    if (type === "open") this.openListeners.push(listener as () => void);
    else if (type === "message") this.messageListeners.push(listener as (event: MessageEvent<unknown>) => void);
    else if (type === "close") this.closeListeners.push(listener as (event: Readonly<{ code: number; reason: string; wasClean: boolean }>) => void);
    else this.errorListeners.push(listener as () => void);
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error("Socket is not open");
    this.sent.push(JSON.parse(data) as AnonymousNetworkClientMessage | NetworkClientMessage);
  }
  close(code?: number, reason?: string): void {
    this.closeCount += 1;
    this.closedWith = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
    this.readyState = 3;
  }
  emitOpen(): void {
    this.readyState = 1;
    for (const listener of this.openListeners) listener();
  }
  emit(message: NetworkServerMessage): void {
    for (const listener of this.messageListeners) listener({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
  emitClose(code = 1006, reason = "", wasClean = false): void {
    this.readyState = 3;
    for (const listener of this.closeListeners) listener({ code, reason, wasClean });
  }
  emitError(): void {
    for (const listener of this.errorListeners) listener();
  }
}

async function connectFake(): Promise<{ client: NetworkClient; socket: FakeSocket }> {
  const socket = new FakeSocket();
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
    requestIdFactory: (() => { let id = 1; return () => `request-${id++}`; })(),
  });
  assert.deepEqual(socket.sent, []);
  socket.emitOpen();
  assert.deepEqual(socket.sent, [{ type: "connectAsPlayer" }]);
  socket.emit({ type: "connected", playerId: "player-1" });
  return { client: await pending, socket };
}

test("waits for socket open and identifies as a player before accepting identity", async () => {
  const { client, socket } = await connectFake();
  assert.equal(client.playerId, "player-1");
  assert.deepEqual(socket.sent, [{ type: "connectAsPlayer" }]);
  await client.close();
  assert.equal(socket.closeCount, 1);
});

test("identifies immediately when a supplied socket is already open", async () => {
  const socket = new FakeSocket();
  socket.readyState = 1;
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
  });
  assert.deepEqual(socket.sent, [{ type: "connectAsPlayer" }]);
  socket.emit({ type: "connected", playerId: "player-1" });
  const client = await pending;
  await client.close();
});

test("sends a fresh player handshake for each reconnect attempt", async () => {
  for (const playerId of ["player-1", "player-2"] as const) {
    const socket = new FakeSocket();
    const pending = NetworkClient.connect("ws://example/ws", {
      webSocketFactory: () => socket,
    });
    socket.emitOpen();
    assert.deepEqual(socket.sent, [{ type: "connectAsPlayer" }]);
    socket.emit({ type: "connected", playerId });
    const client = await pending;
    assert.equal(client.playerId, playerId);
    await client.close();
  }
});

test("rejects a connection closed before player role confirmation", async () => {
  const socket = new FakeSocket();
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
  });
  socket.emitOpen();
  socket.emitClose(1011, "server error", true);
  await assert.rejects(pending, /closed before connecting/);
});

test("resume rejection falls back to a fresh player by default", async () => {
  const socket = new FakeSocket();
  const token = "a".repeat(32);
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
    resumeToken: token,
  });
  socket.emitOpen();
  assert.deepEqual(socket.sent, [{ type: "resumePlayer", resumeToken: token }]);
  socket.emit({ type: "resumeRejected" });
  assert.deepEqual(socket.sent.at(-1), { type: "connectAsPlayer" });
  socket.emit({ type: "connected", playerId: "player-2" });
  const client = await pending;
  assert.equal(client.playerId, "player-2");
  await client.close();
});

test("strict resume rejection rejects without creating a fresh player", async () => {
  const socket = new FakeSocket();
  const token = "a".repeat(32);
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
    resumeToken: token,
    resumeFailure: "reject",
  });
  socket.emitOpen();
  socket.emit({ type: "resumeRejected" });
  await assert.rejects(pending, ResumeRejectedError);
  assert.deepEqual(socket.sent, [{ type: "resumePlayer", resumeToken: token }]);
  assert.equal(socket.closeCount, 1);
});

test("connected resume metadata is marked disconnected on explicit and socket close", async () => {
  const values = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  const prior = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: fakeStorage });
  try {
    const socket = new FakeSocket();
    const pending = NetworkClient.connect("ws://example/ws", { webSocketFactory: () => socket });
    socket.emitOpen();
    socket.emit({
      type: "connected", playerId: "player-1",
      resumeToken: "a".repeat(32), resumeGraceMs: 1_000,
    });
    const client = await pending;
    assert.equal(JSON.parse(values.get("gridgame.resumeSession") ?? "").disconnectedAt, null);
    await client.close();
    assert.equal(typeof JSON.parse(values.get("gridgame.resumeSession") ?? "").disconnectedAt, "number");

    const fresh = loadFreshResumeSession();
    assert.ok(fresh);
    const secondSocket = new FakeSocket();
    const secondPending = NetworkClient.connect("ws://example/ws", { webSocketFactory: () => secondSocket });
    secondSocket.emitOpen();
    secondSocket.emit({
      type: "connected", playerId: "player-1",
      resumeToken: "b".repeat(32), resumeGraceMs: 1_000,
    });
    await secondPending;
    secondSocket.emitClose();
    assert.equal(typeof JSON.parse(values.get("gridgame.resumeSession") ?? "").disconnectedAt, "number");
  } finally {
    if (prior === undefined) delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    else Object.defineProperty(globalThis, "sessionStorage", prior);
  }
});

test("actively closes a socket that errors before player role confirmation", async () => {
  const socket = new FakeSocket();
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
  });

  socket.emitError();

  await assert.rejects(pending, /WebSocket connection failed/);
  assert.equal(socket.closeCount, 1);
});

test("rejects a non-player first server message", async () => {
  const socket = new FakeSocket();
  const pending = NetworkClient.connect("ws://example/ws", {
    webSocketFactory: () => socket,
  });
  socket.emitOpen();
  socket.emit({ type: "worldSnapshot", challengeable: true, snapshot: worldSnapshot() });
  await assert.rejects(pending, /First server message must be connected/);
  assert.equal(socket.closeCount, 1);
  assert.deepEqual(socket.closedWith, {
    code: 4000,
    reason: "invalid server message",
  });
});

test("creates unsolicited sessions automatically, buffers deltas, routes, and leaves one battle", async () => {
  const { client, socket } = await connectFake();
  const events: string[] = [];
  client.subscribe((event) => events.push(event.type));
  socket.emit({
    type: "battleJoined", battleId: "battle-1", localParticipantId: 0,
    roster: [...ROSTER], worldPosition: null,
    snapshot: createBattleSnapshot(),
  });
  const session = client.getSession("battle-1");
  assert.ok(session);
  socket.emit({
    type: "battleMessage", battleId: "battle-1",
    message: { type: "tickProbeResult", probeId: "probe", tick: 2 },
  });
  const received: string[] = [];
  session.subscribe((message) => received.push(message.type));
  assert.deepEqual(received, ["tickProbeResult"]);
  await session.send({ type: "tickProbe", probeId: "probe-2" });
  assert.deepEqual(socket.sent.at(-1), {
    type: "battleMessage", battleId: "battle-1",
    message: { type: "tickProbe", probeId: "probe-2" },
  });
  const leaving = session.close();
  socket.emit({ type: "battleLeft", battleId: "battle-1" });
  await leaving;
  assert.equal(client.getSession("battle-1"), undefined);
  assert.deepEqual(events, ["battleJoined", "battleLeft"]);
  await client.close();
});

test("publishes an unexpected socket close and rejects pending requests", async () => {
  const { client, socket } = await connectFake();
  const events: NetworkClientEvent[] = [];
  client.subscribe((event) => events.push(event));
  socket.emit({ type: "worldSnapshot", challengeable: true, snapshot: worldSnapshot() });
  await client.world.ready;
  const challenge = client.world.challengeCell({ x: 1, y: 0 });
  const challengeRejected = assert.rejects(challenge, /WebSocket closed/);

  socket.emitClose(1011, "server error", true);

  await challengeRejected;
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "connectionClosed");
  assert.equal(events[0]?.type === "connectionClosed" && events[0].reason, "socket");
  assert.equal(
    events[0]?.type === "connectionClosed" ? events[0].error?.message : null,
    "WebSocket closed (1011, clean): server error",
  );
});

test("rejects World readiness when the socket closes before bootstrap", async () => {
  const { client, socket } = await connectFake();
  const readyRejected = assert.rejects(client.world.ready, /WebSocket closed/);

  socket.emitClose();

  await readyRejected;
});

test("publishes a socket error only once when close follows it", async () => {
  const { client, socket } = await connectFake();
  const events: NetworkClientEvent[] = [];
  client.subscribe((event) => events.push(event));

  socket.emitError();
  socket.emitClose();

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event?.type, "connectionClosed");
  if (event?.type !== "connectionClosed") assert.fail("Expected connectionClosed event");
  assert.equal(event.reason, "error");
  assert.match(event.error?.message ?? "", /WebSocket connection failed/);
  assert.equal(socket.closeCount, 1);
});

test("terminates and closes immediately on an invalid established server message", async () => {
  const { client, socket } = await connectFake();
  const events: NetworkClientEvent[] = [];
  client.subscribe((event) => events.push(event));

  socket.emit({ type: "connected", playerId: "player-1" });

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event?.type, "connectionClosed");
  if (event?.type !== "connectionClosed") assert.fail("Expected connectionClosed event");
  assert.equal(event.reason, "error");
  assert.match(event.error?.message ?? "", /duplicate connected/i);
  assert.deepEqual(socket.closedWith, {
    code: 4000,
    reason: "invalid server message",
  });

  socket.emitClose();
  assert.equal(events.length, 1);
});

test("intentional close publishes its reason and terminates joined sessions", async () => {
  const { client, socket } = await connectFake();
  socket.emit({
    type: "battleJoined", battleId: "battle-1", localParticipantId: 0,
    roster: [...ROSTER], worldPosition: { x: 1, y: 2 },
    snapshot: createBattleSnapshot(),
  });
  const session = client.getSession("battle-1");
  assert.ok(session);
  assert.equal(session.localParticipantId, 0);
  assert.deepEqual(session.worldPosition, { x: 1, y: 2 });
  const events: NetworkClientEvent[] = [];
  client.subscribe((event) => events.push(event));

  await client.close();

  assert.equal(socket.closeCount, 1);
  assert.equal(client.getSession("battle-1"), undefined);
  await assert.rejects(session.send({ type: "tickProbe", probeId: "probe" }), /NetworkBattleSession has been closed/);
  const event = events.at(-1);
  assert.equal(event?.type, "connectionClosed");
  if (event?.type !== "connectionClosed") assert.fail("Expected connectionClosed event");
  assert.equal(event.reason, "client");
  assert.equal(event.error, null);

  socket.emitClose();
  assert.equal(events.filter(({ type }) => type === "connectionClosed").length, 1);
});

test("owns a World projection before consumers subscribe and applies deltas", async () => {
  const { client, socket } = await connectFake();
  socket.emit({ type: "worldSnapshot", challengeable: true, snapshot: worldSnapshot(2) });

  assert.equal((await client.world.ready).getSnapshot().snapshot?.revision, 2);
  socket.emit({
    type: "worldDelta",
    challengeable: false,
    fromRevision: 2,
    revision: 3,
    changes: [{
      position: { x: 1, y: 0 },
      cell: { kind: "occupied", playerId: "player-2" },
    }],
  });

  const snapshot = client.world.state.getSnapshot().snapshot;
  assert.equal(snapshot?.revision, 3);
  assert.equal(client.world.state.getSnapshot().challengeable, false);
  assert.deepEqual(snapshot?.grid.cells[1], {
    kind: "occupied",
    playerId: "player-2",
  });
  await client.close();
});

test("requests exactly one snapshot per World revision gap", async () => {
  const { client, socket } = await connectFake();
  socket.emit({ type: "worldSnapshot", challengeable: true, snapshot: worldSnapshot(4) });
  socket.emit({ type: "worldDelta", challengeable: true, fromRevision: 2, revision: 3, changes: [] });
  socket.emit({ type: "worldDelta", challengeable: true, fromRevision: 3, revision: 4, changes: [] });
  assert.equal(
    socket.sent.filter(({ type }) => type === "requestWorldSnapshot").length,
    1,
  );

  socket.emit({ type: "worldSnapshot", challengeable: false, snapshot: worldSnapshot(8) });
  socket.emit({ type: "worldDelta", challengeable: false, fromRevision: 7, revision: 8, changes: [] });
  assert.equal(
    socket.sent.filter(({ type }) => type === "requestWorldSnapshot").length,
    2,
  );
  await client.close();
});

test("correlates accepted and rejected World commands", async () => {
  const { client, socket } = await connectFake();
  const challenge = client.world.challengeCell({ x: 1, y: 0 });
  assert.deepEqual(socket.sent.at(-1), {
    type: "challengeWorldCell",
    requestId: "request-1",
    position: { x: 1, y: 0 },
  });
  socket.emit({ type: "worldCommandAccepted", requestId: "request-1" });
  await challenge;

  const join = client.world.joinChallenge("challenge-1");
  socket.emit({
    type: "worldCommandRejected",
    requestId: "request-2",
    reason: "challengeFull",
  });
  await assert.rejects(join, /challengeFull/);

  const leave = client.world.leaveChallenge("challenge-1");
  assert.deepEqual(socket.sent.at(-1), {
    type: "leaveWorldChallenge",
    requestId: "request-3",
    challengeId: "challenge-1",
  });
  socket.emit({ type: "worldCommandAccepted", requestId: "request-3" });
  await leave;
  await client.close();
});

test("explains battle-limit World command rejections in player-facing language", async () => {
  const { client, socket } = await connectFake();
  const join = client.world.joinChallenge("challenge-1");
  socket.emit({
    type: "worldCommandRejected",
    requestId: "request-1",
    reason: "battleLimitReached",
  });

  await assert.rejects(join, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /maximum number of concurrent battles/i);
    assert.doesNotMatch(error.message, /battleLimitReached/);
    return true;
  });
  await client.close();
});

test("retains multiple battles and removes only the battle that left", async () => {
  const { client, socket } = await connectFake();
  for (const battleId of ["battle-1", "battle-2"] as const) {
    socket.emit({
      type: "battleJoined",
      battleId,
      localParticipantId: 0,
      roster: [...ROSTER],
      worldPosition: null,
      snapshot: createBattleSnapshot(),
    });
  }
  const first = client.getSession("battle-1");
  const second = client.getSession("battle-2");
  assert.ok(first);
  assert.ok(second);
  assert.equal(client.getSessions().length, 2);

  socket.emit({ type: "battleLeft", battleId: "battle-1" });
  assert.equal(client.getSession("battle-1"), undefined);
  assert.equal(client.getSession("battle-2"), second);
  await assert.rejects(
    first.send({ type: "tickProbe", probeId: "closed" }),
    /closed/,
  );
  await second.send({ type: "tickProbe", probeId: "still-open" });
  assert.deepEqual(socket.sent.at(-1), {
    type: "battleMessage",
    battleId: "battle-2",
    message: { type: "tickProbe", probeId: "still-open" },
  });
  await client.close();
});
