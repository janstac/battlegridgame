import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleCell,
  type BattleParticipant,
  type PlayerId,
  type Position,
} from "@grid-game/shared";
import { HostedBattle, type HostedBattleClock } from "./HostedBattle.ts";

const STANDARD_BATTLE_GRID_SIZE = 7;
export const STANDARD_BATTLE_MAX_PARTICIPANTS = 4;

/** Creates the standard deterministic battle layout without network dependencies. */
export class StandardBattleFactory {
  private readonly clock: HostedBattleClock | undefined;

  constructor(clock?: HostedBattleClock) { this.clock = clock; }

  create(
    playerIds: readonly PlayerId[],
    worldPosition: Position | null = null,
  ): HostedBattle {
    this.assertPlayers(playerIds);

    const size = STANDARD_BATTLE_GRID_SIZE;
    const inset = 1;
    const width = size;
    const height = size;
    const participants: BattleParticipant[] = playerIds.map((_, participantId) => ({
      participantId,
      status: "active",
    }));
    const cells: BattleCell[] = Array.from(
      { length: width * height },
      (): BattleCell => ({ kind: "empty" }),
    );
    const startingPositions = [
      { x: inset, y: inset },
      { x: size - inset - 1, y: inset },
      { x: size - inset - 1, y: size - inset - 1 },
      { x: inset, y: size - inset - 1 },
    ] as const;
    for (const participant of participants) {
      const position = startingPositions[participant.participantId];
      if (position === undefined) {
        throw new Error(`Missing starting position for participant ${participant.participantId}`);
      }
      cells[position.y * width + position.x] = {
        kind: "occupied",
        participantId: participant.participantId,
        count: 1,
      };
    }
    const center = Math.floor(size / 2);
    cells[center * width + center] = { kind: "wall" };
    const engine = BattleEngine.create(
      { participants, grid: { width, height, cells } },
      DEFAULT_BATTLE_CONFIG,
      new FixedCooldownPolicy(10),
    );
    const roster = playerIds.map((playerId, participantId) => ({
      participantId,
      playerId,
    }));
    return new HostedBattle(engine, roster, {
      ...(this.clock === undefined ? {} : { clock: this.clock }),
      worldPosition,
    });
  }

  private assertPlayers(playerIds: readonly PlayerId[]): void {
    if (playerIds.length < 2 || playerIds.length > STANDARD_BATTLE_MAX_PARTICIPANTS) {
      throw new Error(
        `Standard battles require 2-${STANDARD_BATTLE_MAX_PARTICIPANTS} players`,
      );
    }
    if (new Set(playerIds).size !== playerIds.length) {
      throw new Error("Standard battles require unique players");
    }
    if (playerIds.some((playerId) => playerId.length === 0)) {
      throw new Error("Standard battles require non-empty player identifiers");
    }
  }
}
