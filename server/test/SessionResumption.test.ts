import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { WebSocket } from "ws";
import {
  NetworkClient,
  type NetworkWebSocket,
} from "../../client/src/session/NetworkClient.ts";
import { createGridGameServer } from "../src/server.ts";

const TIMEOUT_MS = 2_000;

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function startServer(t: TestContext) {
  const server = createGridGameServer({
    debugEnabled: true,
    worldRandom: { next: () => 0 },
    playerSessionResumeGraceMs: 1_000,
  });
  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  });
  t.after(async () => server.close());
  const address = server.httpServer.address() as AddressInfo;
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const connect = (resumeToken?: string) => NetworkClient.connect(url, {
    webSocketFactory: (target) => new WebSocket(target) as NetworkWebSocket,
    ...(resumeToken === undefined ? {} : { resumeToken }),
  });
  return { server, connect };
}

test("a replacement WebSocket resumes the same player and battle session", async (t) => {
  const app = await startServer(t);
  const first = await app.connect();
  const other = await app.connect();
  await Promise.all([first.world.ready, other.world.ready]);

  assert.ok(first.resumeToken);
  assert.equal(first.resumeGraceMs, 1_000);
  const playerId = first.playerId;
  const resumeToken = first.resumeToken;
  const requester = app.server.players.get(playerId);
  assert.ok(requester);
  assert.equal(await app.server.coordinator.createDebugBattle(
    requester,
    [first.playerId, other.playerId],
  ), null);
  await waitFor(() => first.getSessions().length === 1, "initial battle membership");
  const battleId = first.getSessions()[0]?.battleId;
  assert.ok(battleId);

  await first.close();
  await waitFor(
    () => app.server.players.get(playerId)?.isAttached === false,
    "server transport detach",
  );
  assert.ok(app.server.players.get(playerId), "logical session should survive grace period");

  const resumed = await app.connect(resumeToken);
  await resumed.world.ready;
  assert.equal(resumed.playerId, playerId);
  assert.equal(resumed.resumeGraceMs, 1_000);
  await waitFor(() => resumed.getSession(battleId) !== undefined, "resumed battle snapshot");
  assert.equal(resumed.getSession(battleId)?.battleId, battleId);

  await resumed.close();
  await other.close();
});
