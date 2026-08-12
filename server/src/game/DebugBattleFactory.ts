import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleCell,
  type PlayerId,
} from "@grid-game/shared";
import { HostedBattle, type HostedBattleClock } from "./HostedBattle.ts";

/** Creates deterministic development battles without any network dependency. */
export class DebugBattleFactory {
  private readonly clock: HostedBattleClock | undefined;

  constructor(clock?: HostedBattleClock) { this.clock = clock; }

  create(playerIds: readonly PlayerId[]): HostedBattle {
    const width = playerIds.length;
    const height = 2;
    const cells: BattleCell[] = Array.from(
      { length: width * height },
      (): BattleCell => ({ kind: "empty" }),
    );
    for (const [index, playerId] of playerIds.entries()) {
      cells[index] = { kind: "occupied", playerId, count: 1 };
    }
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
