import assert from "node:assert/strict";
import test from "node:test";

import type {
  NetworkBattleSession,
  NetworkClient,
  NetworkClientEvent,
} from "@grid-game/client/headless";

import type { BotSignalSource } from "../src/cli.ts";
import { parseBotUrl, runBotCli } from "../src/cli.ts";

class FakeSignals implements BotSignalSource {
  private readonly listeners = new Map<"SIGINT" | "SIGTERM", Set<() => void>>();

  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  emit(signal: "SIGINT" | "SIGTERM"): void {
    for (const listener of [...this.listeners.get(signal) ?? []]) listener();
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

class FakeCliClient {
  readonly playerId = "player-bot";
  readonly world: { ready: Promise<unknown> };
  closeCount = 0;
  private readonly listeners = new Set<(event: NetworkClientEvent) => void>();

  constructor(worldReady: Promise<unknown> = Promise.resolve()) {
    this.world = { ready: worldReady };
  }

  subscribe(listener: (event: NetworkClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSessions(): readonly NetworkBattleSession[] { return []; }

  async close(): Promise<void> { this.closeCount += 1; }

  disconnect(reason: "socket" | "error", error: Error): void {
    for (const listener of [...this.listeners]) {
      listener({ type: "connectionClosed", reason, error });
    }
  }
}

test("validates exactly one WebSocket URL", () => {
  assert.equal(parseBotUrl(["ws://localhost:3000/ws"]), "ws://localhost:3000/ws");
  assert.equal(parseBotUrl(["wss://example.test/game"]), "wss://example.test/game");
  assert.throws(() => parseBotUrl([]), /Usage/);
  assert.throws(() => parseBotUrl(["not a url"]), /valid ws: or wss:/);
  assert.throws(() => parseBotUrl(["https://example.test"]), /must use ws: or wss:/);
  assert.throws(() => parseBotUrl(["ws://a", "ws://b"]), /Usage/);
});

test("prints the assigned ID, waits for World bootstrap, and exits cleanly on signal", async () => {
  const client = new FakeCliClient();
  const signals = new FakeSignals();
  const output: string[] = [];
  const errors: string[] = [];
  const running = runBotCli(["ws://example.test/ws"], {
    connect: async () => client as unknown as NetworkClient,
    signals,
    writeOutput: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(output, ["Connected as player-bot"]);
  signals.emit("SIGTERM");
  assert.equal(await running, 0);
  assert.equal(client.closeCount, 1);
  assert.deepEqual(errors, []);
  assert.equal(signals.listenerCount, 0);
});

test("returns nonzero for connection and socket failures without reconnecting", async () => {
  const connectErrors: string[] = [];
  assert.equal(await runBotCli(["ws://example.test/ws"], {
    connect: async () => { throw new Error("connect failed"); },
    signals: new FakeSignals(),
    writeError: (line) => connectErrors.push(line),
  }), 1);
  assert.equal(connectErrors.length, 1);
  assert.match(connectErrors[0] ?? "", /^Error: connect failed\n/);

  const client = new FakeCliClient();
  const socketErrors: string[] = [];
  const running = runBotCli(["ws://example.test/ws"], {
    connect: async () => client as unknown as NetworkClient,
    signals: new FakeSignals(),
    writeOutput: () => undefined,
    writeError: (line) => socketErrors.push(line),
  });
  await Promise.resolve();
  await Promise.resolve();
  client.disconnect("socket", new Error("socket failed"));
  assert.equal(await running, 1);
  assert.equal(socketErrors.length, 1);
  assert.match(socketErrors[0] ?? "", /^Error: socket failed\n/);
  assert.equal(client.closeCount, 0);
});

test("invalid arguments fail before opening a connection", async () => {
  let connects = 0;
  const errors: string[] = [];
  assert.equal(await runBotCli([], {
    connect: async () => { connects += 1; throw new Error("unexpected"); },
    signals: new FakeSignals(),
    writeError: (line) => errors.push(line),
  }), 2);
  assert.equal(connects, 0);
  assert.match(errors[0] ?? "", /Usage/);
});
