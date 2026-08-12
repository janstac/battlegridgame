import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleCell,
  type PlayerId,
} from "@grid-game/shared";
import { HostedBattle, type HostedBattleClock } from "./HostedBattle.ts";

const DEBUG_GRID_SIZE = 7;
export const MAX_DEBUG_PLAYERS = 4;

/** Creates deterministic development battles without any network dependency. */
export class DebugBattleFactory {
  private readonly clock: HostedBattleClock | undefined;

  constructor(clock?: HostedBattleClock) { this.clock = clock; }

  create(playerIds: readonly PlayerId[]): HostedBattle {
    if (playerIds.length > MAX_DEBUG_PLAYERS) {
      throw new Error(`Debug battles support at most ${MAX_DEBUG_PLAYERS} players`);
    }

    const size = DEBUG_GRID_SIZE;
    const inset = 1;
    const width = size;
    const height = size;
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
    for (const [index, playerId] of playerIds.entries()) {
      const position = startingPositions[index];
      if (position === undefined) {
        throw new Error(`Missing starting position for player ${index + 1}`);
      }
      cells[position.y * width + position.x] = {
        kind: "occupied",
        playerId,
        count: 1,
      };
    }
    const center = Math.floor(size / 2);
    cells[center * width + center] = { kind: "wall" };
    const engine = BattleEngine.create(
      { players: [...playerIds], grid: { width, height, cells } },
      DEFAULT_BATTLE_CONFIG,
      new FixedCooldownPolicy(10),
    );
    return this.clock === undefined
      ? new HostedBattle(engine)
      : new HostedBattle(engine, this.clock);
  }
}
