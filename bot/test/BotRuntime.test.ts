import assert from "node:assert/strict";
import test from "node:test";

import type {
  NetworkBattleSession,
  NetworkClientEvent,
} from "@grid-game/client/headless";
import type { BattleId, PlayerId } from "@grid-game/shared";

import type { Bot } from "../src/Bot.ts";
import {
  BotRuntime,
  type BotController,
  type BotRuntimeClient,
  type BotRuntimeSession,
} from "../src/BotRuntime.ts";
import { RecordingConnection } from "./helpers.ts";

class FakeSession extends RecordingConnection implements BotRuntimeSession {
  readonly battleId: BattleId;
  readonly localParticipantId = 0;

  constructor(battleId: BattleId) {
    super();
    this.battleId = battleId;
  }
}

class FakeClient implements BotRuntimeClient {
  readonly playerId: PlayerId = "bot-player";
  readonly sessions: FakeSession[] = [];
  closeCount = 0;
  onSubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(event: NetworkClientEvent) => void>();

  subscribe(listener: (event: NetworkClientEvent) => void): () => void {
    this.listeners.add(listener);
    this.onSubscribe?.();
    return () => this.listeners.delete(listener);
  }

  getSessions(): readonly NetworkBattleSession[] {
    return this.sessions as unknown as readonly NetworkBattleSession[];
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  join(session: FakeSession): void {
    if (!this.sessions.includes(session)) this.sessions.push(session);
    this.emit({
      type: "battleJoined",
      session: session as unknown as NetworkBattleSession,
    });
  }

  leave(battleId: BattleId): void {
    const index = this.sessions.findIndex((session) => session.battleId === battleId);
    if (index >= 0) this.sessions.splice(index, 1);
    this.emit({ type: "battleLeft", battleId });
  }

  disconnect(reason: "socket" | "error", error: Error): void {
    this.emit({ type: "connectionClosed", reason, error });
  }

  private emit(event: NetworkClientEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

class FakeController implements BotController {
  disposeCount = 0;
  async dispose(): Promise<void> { this.disposeCount += 1; }
}

function runtimeFixture(client: FakeClient) {
  const created: Array<{
    session: BotRuntimeSession;
    bot: Bot;
    controller: FakeController;
    fail(error: Error): void;
  }> = [];
  const factoryContexts: unknown[] = [];
  const runtime = new BotRuntime(
    client,
    (context) => {
      factoryContexts.push(context);
      return { decide: () => null };
    },
    {
      createController: (session, bot, fail) => {
        const controller = new FakeController();
        created.push({ session, bot, controller, fail });
        return controller;
      },
    },
  );
  return { runtime, created, factoryContexts };
}

test("subscribes before reconciliation and attaches a racing session once", async () => {
  const client = new FakeClient();
  const session = new FakeSession("battle-race");
  client.onSubscribe = () => client.join(session);

  const { runtime, created, factoryContexts } = runtimeFixture(client);
  assert.equal(runtime.controllerCount, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(factoryContexts, [{ battleId: "battle-race", localParticipantId: 0 }]);
  await runtime.stop();
});

test("controls existing and later battles independently and detaches idempotently", async () => {
  const client = new FakeClient();
  const first = new FakeSession("battle-1");
  const second = new FakeSession("battle-2");
  client.sessions.push(first);
  const { runtime, created } = runtimeFixture(client);

  client.join(second);
  client.join(second);
  assert.equal(runtime.controllerCount, 2);
  assert.equal(created.length, 2);
  client.leave(first.battleId);
  client.leave(first.battleId);
  await Promise.resolve();
  assert.equal(runtime.controllerCount, 1);
  assert.equal(created[0]?.controller.disposeCount, 1);

  await runtime.stop();
  assert.equal(client.closeCount, 1);
  assert.equal(created[1]?.controller.disposeCount, 1);
  assert.equal(runtime.controllerCount, 0);
});

test("socket closure disposes every controller without reconnecting", async () => {
  const client = new FakeClient();
  client.sessions.push(new FakeSession("battle-1"), new FakeSession("battle-2"));
  const { runtime, created } = runtimeFixture(client);
  const error = new Error("socket closed");

  client.disconnect("socket", error);
  assert.deepEqual(await runtime.done, { reason: "socket", error });
  assert.equal(client.closeCount, 0);
  assert.deepEqual(created.map(({ controller }) => controller.disposeCount), [1, 1]);
});

test("a controller failure closes the player and reports an operational error", async () => {
  const client = new FakeClient();
  client.sessions.push(new FakeSession("battle-1"));
  const { runtime, created } = runtimeFixture(client);
  const error = new Error("strategy crashed");

  created[0]?.fail(error);
  assert.deepEqual(await runtime.done, { reason: "error", error });
  assert.equal(client.closeCount, 1);
  assert.equal(created[0]?.controller.disposeCount, 1);
});

test("stop is idempotent and resolves successful client shutdown", async () => {
  const client = new FakeClient();
  const { runtime } = runtimeFixture(client);
  const [first, second] = await Promise.all([runtime.stop(), runtime.stop()]);
  assert.deepEqual(first, { reason: "client", error: null });
  assert.deepEqual(second, first);
  assert.equal(client.closeCount, 1);
});
