import { createServer, type Server as HttpServer } from "node:http";
import { BattleCoordinator } from "./application/BattleCoordinator.ts";
import { PlayerDirectory } from "./application/PlayerDirectory.ts";
import { BattleRegistry } from "./game/BattleRegistry.ts";
import { DebugBattleFactory } from "./game/DebugBattleFactory.ts";
import type { HostedBattleClock } from "./game/HostedBattle.ts";
import { BattleWebSocketGateway } from "./network/BattleWebSocketGateway.ts";

export type GridGameServerOptions = Readonly<{
  debugEnabled?: boolean;
  maxDebugPlayers?: number;
  battleClock?: HostedBattleClock;
}>;

export type GridGameServer = Readonly<{
  httpServer: HttpServer;
  players: PlayerDirectory;
  battles: BattleRegistry;
  coordinator: BattleCoordinator;
  close(): Promise<void>;
}>;

/** Composes the HTTP/WebSocket transport and transport-free application. */
export function createGridGameServer(options: GridGameServerOptions = {}): GridGameServer {
  const httpServer = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const players = new PlayerDirectory();
  const battles = new BattleRegistry();
  const coordinatorOptions = options.maxDebugPlayers === undefined
    ? { debugEnabled: options.debugEnabled ?? false }
    : { debugEnabled: options.debugEnabled ?? false, maxDebugPlayers: options.maxDebugPlayers };
  const coordinator = new BattleCoordinator(
    players,
    battles,
    new DebugBattleFactory(options.battleClock),
    coordinatorOptions,
  );
  const gateway = new BattleWebSocketGateway(httpServer, players, coordinator);
  return {
    httpServer,
    players,
    battles,
    coordinator,
    async close() {
      gateway.close();
      await battles.dispose();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => httpServer.close((error) => {
          if (error) reject(error); else resolve();
        }));
      }
    },
  };
}
