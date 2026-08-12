import type {
  DebugCreateBattleRejectionReason,
  PlayerId,
  RequestId,
} from "@grid-game/shared";
import type { ClientConnection } from "./ClientConnection.ts";
import type { PlayerDirectory } from "./PlayerDirectory.ts";
import type { BattleRegistry } from "../game/BattleRegistry.ts";
import type { DebugBattleFactory } from "../game/DebugBattleFactory.ts";

export type BattleCoordinatorOptions = Readonly<{
  debugEnabled: boolean;
  maxDebugPlayers?: number;
}>;

/** Coordinates validated multi-player mutations across application services. */
export class BattleCoordinator {
  readonly debugEnabled: boolean;
  private readonly maxDebugPlayers: number;
  private readonly players: PlayerDirectory;
  private readonly battles: BattleRegistry;
  private readonly factory: DebugBattleFactory;

  constructor(
    players: PlayerDirectory,
    battles: BattleRegistry,
    factory: DebugBattleFactory,
    options: BattleCoordinatorOptions,
  ) {
    this.players = players;
    this.battles = battles;
    this.factory = factory;
    this.debugEnabled = options.debugEnabled;
    this.maxDebugPlayers = options.maxDebugPlayers ?? 8;
  }

  connectedPlayerIds(): readonly PlayerId[] { return this.players.playerIds(); }

  createDebugBattle(
    requester: ClientConnection,
    requestId: RequestId,
    playerIds: readonly PlayerId[],
  ): DebugCreateBattleRejectionReason | null {
    if (!this.debugEnabled) return "debugDisabled";
    if (playerIds.length < 2 || playerIds.length > this.maxDebugPlayers) {
      return "invalidPlayerCount";
    }
    if (new Set(playerIds).size !== playerIds.length) return "duplicatePlayerIds";
    if (!playerIds.includes(requester.playerId)) return "requesterNotIncluded";
    const participants = playerIds.map((id) => this.players.get(id));
    if (participants.some((participant) => participant === undefined)) return "unknownPlayer";

    const battle = this.factory.create(playerIds);
    const battleId = this.battles.register(battle);
    for (const participant of participants as ClientConnection[]) {
      participant.attachBattle(
        battleId,
        battle,
        participant === requester ? requestId : null,
      );
    }
    battle.start();
    return null;
  }
}
