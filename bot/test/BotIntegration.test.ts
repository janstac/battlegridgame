import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  NetworkClient,
  type NetworkBattleSession,
  type NetworkClientEvent,
} from "@grid-game/client/headless";
import type { BattleParticipantId, ServerMessage } from "@grid-game/shared";
import { createGridGameServer } from "../../server/src/server.ts";
import type { HostedBattleClock } from "../../server/src/game/HostedBattle.ts";
import { BotRuntime } from "../src/BotRuntime.ts";
import { RandomBot } from "../src/RandomBot.ts";

const ASYNC_TIMEOUT_MS = 3_000;

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

class ManualBattleClock implements HostedBattleClock {
  setInterval(_callback: () => void, _intervalMs: number): unknown { return 1; }
  clearInterval(_handle: unknown): void {}
}

async function startServer(t: TestContext) {
  const server = createGridGameServer({
    debugEnabled: true,
    battleClock: new ManualBattleClock(),
    worldRandom: { next: () => 0 },
  });
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  }), "server listen");
  const address = server.httpServer.address() as AddressInfo;
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const clients = new Set<NetworkClient>();
  const connect = async (): Promise<NetworkClient> => {
    const client = await withTimeout(NetworkClient.connect(url), "player handshake");
    clients.add(client);
    await withTimeout(client.world.ready, "World bootstrap");
    return client;
  };
  t.after(async () => {
    await Promise.all([...clients].map(async (client) => client.close()));
    await server.close();
  });
  return { server, connect };
}

type PlayedBattle = Readonly<{
  session: NetworkBattleSession;
  botParticipantId: BattleParticipantId;
  increment: Extract<ServerMessage, { type: "cellIncremented" }>;
  cooldown: Extract<ServerMessage, { type: "cooldownChanged" }>;
}>;

function waitForBotPlay(
  observer: NetworkClient,
  botPlayerId: string,
): Promise<PlayedBattle> {
  return withTimeout(new Promise((resolve) => {
    let unsubscribeClient: () => void = () => undefined;
    unsubscribeClient = observer.subscribe((event: NetworkClientEvent) => {
      if (event.type !== "battleJoined") return;
      unsubscribeClient();
      const session = event.session;
      const botParticipantId = session.roster.find(
        ({ playerId }) => playerId === botPlayerId,
      )?.participantId;
      assert.notEqual(botParticipantId, undefined);
      let increment: PlayedBattle["increment"] | null = null;
      let cooldown: PlayedBattle["cooldown"] | null = null;
      const unsubscribeSession = session.subscribe((message) => {
        if (
          message.type === "cellIncremented"
          && message.source === "command"
          && message.cell.participantId === botParticipantId
        ) {
          increment = message;
        }
        if (
          message.type === "cooldownChanged"
          && message.cooldown.participantId === botParticipantId
        ) {
          cooldown = message;
        }
        if (increment !== null && cooldown !== null && botParticipantId !== undefined) {
          unsubscribeSession();
          resolve({ session, botParticipantId, increment, cooldown });
        }
      });
    });
  }), "bot increment and cooldown");
}

async function waitForControllerCount(runtime: BotRuntime, expected: number): Promise<void> {
  await withTimeout((async () => {
    while (runtime.controllerCount !== expected) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  })(), `${expected} bot controllers`);
}

test("one ordinary headless player acts independently in two concurrent battles", async (t) => {
  const app = await startServer(t);
  const botClient = await app.connect();
  const firstOpponent = await app.connect();
  const secondOpponent = await app.connect();
  const runtime = new BotRuntime(botClient, () => new RandomBot(() => 0));
  t.after(async () => { await runtime.stop(); });

  const firstPlayed = waitForBotPlay(firstOpponent, botClient.playerId);
  const secondPlayed = waitForBotPlay(secondOpponent, botClient.playerId);
  const requester = app.server.players.get(botClient.playerId);
  assert.ok(requester);
  assert.equal(await app.server.coordinator.createDebugBattle(
    requester,
    [botClient.playerId, firstOpponent.playerId],
  ), null);
  assert.equal(await app.server.coordinator.createDebugBattle(
    requester,
    [botClient.playerId, secondOpponent.playerId],
  ), null);

  const [first, second] = await Promise.all([firstPlayed, secondPlayed]);
  await waitForControllerCount(runtime, 2);
  for (const played of [first, second]) {
    assert.equal(played.increment.tick, 0);
    assert.equal(played.increment.cell.count, 2);
    assert.deepEqual(played.cooldown.cooldown, {
      participantId: played.botParticipantId,
      nextActionTick: 20,
      durationTicks: 20,
      acceptedActionCount: 1,
    });
    const initialIndex = played.increment.position.y
      * played.session.initialSnapshot.grid.width
      + played.increment.position.x;
    const initialCell = played.session.initialSnapshot.grid.cells[initialIndex];
    assert.equal(initialCell?.kind, "occupied");
    assert.equal(
      initialCell?.kind === "occupied" ? initialCell.participantId : -1,
      played.botParticipantId,
    );
  }

  await Promise.all(botClient.getSessions().map(async (session) => session.close()));
  await waitForControllerCount(runtime, 0);
  const result = await runtime.stop();
  assert.deepEqual(result, { reason: "client", error: null });
  assert.equal(botClient.getSessions().length, 0);
});
