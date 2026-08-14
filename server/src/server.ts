import { createServer, type Server as HttpServer } from "node:http";
import { AdminService } from "./admin/AdminService.ts";
import { WorldCoordinator } from "./application/WorldCoordinator.ts";
import { PlayerDirectory } from "./application/PlayerDirectory.ts";
import { BattleRegistry } from "./game/BattleRegistry.ts";
import { StandardBattleFactory } from "./game/StandardBattleFactory.ts";
import type { HostedBattleClock } from "./game/HostedBattle.ts";
import {
  BattleWebSocketGateway,
  type AdminMessageHandler,
} from "./network/BattleWebSocketGateway.ts";
import type { PendingChallengeClock } from "./world/PendingChallenge.ts";
import { World, type RandomSource } from "./world/World.ts";

export type GridGameServerOptions = Readonly<{
  debugEnabled?: boolean;
  maxDebugPlayers?: number;
  battleClock?: HostedBattleClock;
  challengeClock?: PendingChallengeClock;
  challengeDurationMs?: number;
  worldRandom?: RandomSource;
  adminMessageHandler?: AdminMessageHandler;
}>;

export type GridGameServer = Readonly<{
  httpServer: HttpServer;
  players: PlayerDirectory;
  battles: BattleRegistry;
  world: World;
  coordinator: WorldCoordinator;
  close(): Promise<void>;
}>;

/** Composes the HTTP/WebSocket transport and transport-free application. */
export function createGridGameServer(options: GridGameServerOptions = {}): GridGameServer {
  const httpServer = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const world = new World({
    ...(options.worldRandom === undefined ? {} : { random: options.worldRandom }),
  });
  const coordinator = new WorldCoordinator(
    players,
    battles,
    world,
    new StandardBattleFactory(options.battleClock),
    {
      debugEnabled: options.debugEnabled ?? false,
      ...(options.maxDebugPlayers === undefined ? {} : { maxDebugPlayers: options.maxDebugPlayers }),
      ...(options.challengeClock === undefined ? {} : { challengeClock: options.challengeClock }),
      ...(options.challengeDurationMs === undefined ? {} : { challengeDurationMs: options.challengeDurationMs }),
    },
  );
  const admin = new AdminService(coordinator);
  const adminMessageHandler: AdminMessageHandler = options.adminMessageHandler
    ?? (async (message, output) => {
      output(await admin.dispatch(message));
    });
  const gateway = new BattleWebSocketGateway(
    httpServer,
    players,
    coordinator,
    adminMessageHandler,
  );
  return {
    httpServer,
    players,
    battles,
    world,
    coordinator,
    async close() {
      await gateway.close();
      await coordinator.dispose();
      await battles.dispose();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => httpServer.close((error) => {
          if (error) reject(error); else resolve();
        }));
      }
    },
  };
}
