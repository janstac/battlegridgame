import type {
  AdminNetworkClientMessage,
  AdminNetworkServerMessage,
} from "@grid-game/shared";
import type { WorldCoordinator } from "../application/WorldCoordinator.ts";

/** Typed transport-independent dispatcher for authenticated admin sessions. */
export class AdminService {
  private readonly coordinator: WorldCoordinator;

  constructor(coordinator: WorldCoordinator) {
    this.coordinator = coordinator;
  }

  async dispatch(
    message: AdminNetworkClientMessage,
  ): Promise<AdminNetworkServerMessage> {
    try {
      switch (message.type) {
        case "adminListPlayers":
          return {
            type: "adminPlayers",
            requestId: message.requestId,
            playerIds: [...await this.coordinator.adminListPlayers()],
          };
        case "adminGetWorld":
          return {
            type: "adminWorld",
            requestId: message.requestId,
            snapshot: await this.coordinator.adminGetWorld(),
          };
        case "adminListBattles":
          return {
            type: "adminBattles",
            requestId: message.requestId,
            battles: [...await this.coordinator.adminListBattles()],
          };
        case "adminStartBattle": {
          const result = await this.coordinator.adminStartBattle(message.playerIds);
          return result.ok
            ? {
                type: "adminBattleStarted",
                requestId: message.requestId,
                battle: result.battle,
              }
            : {
                type: "adminError",
                requestId: message.requestId,
                code: result.code,
                message: result.message,
              };
        }
        case "adminReplaceWorldCells": {
          const result = await this.coordinator.adminReplaceWorldCells(message.changes);
          return result.ok
            ? {
                type: "adminWorldCellsReplaced",
                requestId: message.requestId,
                revision: result.delta.revision,
                changes: [...result.delta.changes],
              }
            : {
                type: "adminError",
                requestId: message.requestId,
                code: result.code,
                message: result.message,
              };
        }
      }
    } catch {
      return {
        type: "adminError",
        requestId: message.requestId,
        code: "internal",
        message: "Admin command failed",
      };
    }
  }
}
