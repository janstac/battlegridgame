import type { BattleId, PlayerId } from "@grid-game/shared";
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

  /** Unregisters a battle before awaiting its disposal. */
  async remove(battleId: BattleId): Promise<boolean> {
    const battle = this.battles.get(battleId);
    if (battle === undefined) return false;
    this.battles.delete(battleId);
    await battle.dispose();
    return true;
  }

  membershipsForPlayer(playerId: PlayerId): ReadonlyArray<Readonly<{
    battleId: BattleId;
    battle: HostedBattle;
  }>> {
    const memberships: Array<{ battleId: BattleId; battle: HostedBattle }> = [];
    for (const [battleId, battle] of this.battles) {
      if (battle.hasPlayer(playerId)) memberships.push({ battleId, battle });
    }
    return memberships;
  }

  async dispose(): Promise<void> {
    const battles = [...this.battles.values()];
    this.battles.clear();
    await Promise.all(battles.map((battle) => battle.dispose()));
  }
}
