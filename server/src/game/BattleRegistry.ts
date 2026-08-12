import type { BattleId } from "@grid-game/shared";
import type { HostedBattle } from "./HostedBattle.ts";

/** Owns hosted battles and monotonic process-local identifiers. */
export class BattleRegistry {
  private readonly battles = new Map<BattleId, HostedBattle>();
  private nextSequence = 1;

  register(battle: HostedBattle): BattleId {
    const battleId = `battle-${this.nextSequence++}`;
    this.battles.set(battleId, battle);
    return battleId;
  }

  get(battleId: BattleId): HostedBattle | undefined { return this.battles.get(battleId); }

  async dispose(): Promise<void> {
    const battles = [...this.battles.values()];
    this.battles.clear();
    await Promise.all(battles.map((battle) => battle.dispose()));
  }
}
