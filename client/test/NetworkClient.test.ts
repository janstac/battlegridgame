import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkClientMessage, NetworkServerMessage } from "@grid-game/shared";
import {
  NetworkClient,
  type NetworkClientEvent,
  type NetworkWebSocket,
} from "../src/session/NetworkClient.ts";
import { createBattleSnapshot } from "./helpers.ts";

class FakeSocket implements NetworkWebSocket {
  readyState = 1;
  readonly sent: NetworkClientMessage[] = [];
  closeCount = 0;
  private readonly messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];
  private readonly closeListeners: Array<() => void> = [];
  private readonly errorListeners: Array<() => void> = [];

  addEventListener(type: "message" | "close" | "error", listener: ((event: MessageEvent<unknown>) => void) | (() => void)): void {
    if (type === "message") this.messageListeners.push(listener as (event: MessageEvent<unknown>) => void);
    else if (type === "close") this.closeListeners.push(listener as () => void);
    else this.errorListeners.push(listener as () => void);
  }
  send(data: string): void { this.sent.push(JSON.parse(data) as NetworkClientMessage); }
  close(): void { this.closeCount += 1; this.readyState = 3; }
  emit(message: NetworkServerMessage): void {
    for (const listener of this.messageListeners) listener({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
  emitClose(): void {
    this.readyState = 3;
    for (const listener of this.closeListeners) listener();
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
  socket.emit({ type: "connected", playerId: "player-1" });
  return { client: await pending, socket };
}

test("connects on the initial identity and correlates debug player snapshots", async () => {
  const { client, socket } = await connectFake();
  assert.equal(client.playerId, "player-1");
  const pending = client.debugGetPlayerIds();
  assert.deepEqual(socket.sent.at(-1), { type: "debugGetPlayerIds", requestId: "request-1" });
  socket.emit({ type: "debugPlayerIds", requestId: "request-1", playerIds: ["player-1", "player-2"] });
  assert.deepEqual(await pending, ["player-1", "player-2"]);
  await client.close();
  assert.equal(socket.closeCount, 1);
});

test("creates sessions automatically, buffers deltas, routes, and leaves one battle", async () => {
  const { client, socket } = await connectFake();
  const events: string[] = [];
  client.subscribe((event) => events.push(event.type));
  const creating = client.debugCreateBattle(["player-1", "player-2"]);
  socket.emit({
    type: "battleJoined", battleId: "battle-1", playerId: "player-1",
    snapshot: createBattleSnapshot(), createRequestId: "request-1",
  });
  const session = await creating;
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

test("debug rejections reject their correlated promises", async () => {
  const { client, socket } = await connectFake();
  const pending = client.debugCreateBattle(["player-1"]);
  socket.emit({ type: "debugCreateBattleRejected", requestId: "request-1", reason: "invalidPlayerCount" });
  await assert.rejects(pending, /invalidPlayerCount/);
  const players = client.debugGetPlayerIds();
  socket.emit({ type: "debugGetPlayerIdsRejected", requestId: "request-2", reason: "debugDisabled" });
  await assert.rejects(players, /debugDisabled/);
  await client.close();
});

test("publishes an unexpected socket close and rejects pending requests", async () => {
  const { client, socket } = await connectFake();
  const events: NetworkClientEvent[] = [];
  client.subscribe((event) => events.push(event));
  const players = client.debugGetPlayerIds();
  const battle = client.debugCreateBattle(["player-1"]);
  const playersRejected = assert.rejects(players, /WebSocket closed/);
  const battleRejected = assert.rejects(battle, /WebSocket closed/);

  socket.emitClose();

  await Promise.all([playersRejected, battleRejected]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "connectionClosed");
  assert.equal(events[0]?.type === "connectionClosed" && events[0].reason, "socket");
  assert.match(events[0]?.type === "connectionClosed" ? events[0].error?.message ?? "" : "", /WebSocket closed/);
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
});

test("intentional close publishes its reason and terminates joined sessions", async () => {
  const { client, socket } = await connectFake();
  socket.emit({
    type: "battleJoined", battleId: "battle-1", playerId: "player-1",
    snapshot: createBattleSnapshot(), createRequestId: null,
  });
  const session = client.getSession("battle-1");
  assert.ok(session);
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
