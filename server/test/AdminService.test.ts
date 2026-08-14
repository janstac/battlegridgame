import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkServerMessage } from "@grid-game/shared";
import { AdminService } from "../src/admin/AdminService.ts";
import { ClientConnection } from "../src/application/ClientConnection.ts";
import { PlayerDirectory } from "../src/application/PlayerDirectory.ts";
import { WorldCoordinator } from "../src/application/WorldCoordinator.ts";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import { StandardBattleFactory } from "../src/game/StandardBattleFactory.ts";
import type { HostedBattleClock } from "../src/game/HostedBattle.ts";
import { World } from "../src/world/World.ts";

const battleClock: HostedBattleClock = {
  setInterval: () => 1,
  clearInterval: () => undefined,
};

async function harness() {
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const world = new World({ random: { next: () => 0 } });
  const coordinator = new WorldCoordinator(
    players,
    battles,
    world,
    new StandardBattleFactory(battleClock),
    { debugEnabled: true },
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
  return { players, battles, world, coordinator, admin, connect };
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
