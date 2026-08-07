import type { PlayerCooldown, PlayerId } from "../domain/index.ts";

/** Tracks per-player action availability for one battle. */
export class CooldownTracker {
  private readonly nextTicksByPlayer = new Map<PlayerId, number>();

  /** Restores cooldown state from optional serialized entries. */
  constructor(initial: readonly PlayerCooldown[] = []) {
    for (const cooldown of initial) {
      if (this.nextTicksByPlayer.has(cooldown.playerId)) {
        throw new Error(`Duplicate cooldown for player ${cooldown.playerId}`);
      }
      this.assertTick(cooldown.nextActionTick, "Next action tick");
      this.nextTicksByPlayer.set(cooldown.playerId, cooldown.nextActionTick);
    }
  }

  /** Returns whether a player may act at the supplied tick. */
  canAct(playerId: PlayerId, currentTick: number): boolean {
    this.assertTick(currentTick, "Current tick");
    return currentTick >= this.nextActionTick(playerId);
  }

  /** Returns the first tick at which a player may act. */
  nextActionTick(playerId: PlayerId): number {
    return this.nextTicksByPlayer.get(playerId) ?? 0;
  }

  /** Returns the non-negative wait remaining at the supplied tick. */
  remainingTicks(playerId: PlayerId, currentTick: number): number {
    this.assertTick(currentTick, "Current tick");
    return Math.max(0, this.nextActionTick(playerId) - currentTick);
  }

  /** Starts or replaces a player's cooldown and returns its serialized form. */
  start(
    playerId: PlayerId,
    currentTick: number,
    durationTicks: number,
  ): PlayerCooldown {
    this.assertTick(currentTick, "Current tick");
    this.assertTick(durationTicks, "Cooldown duration");
    const nextActionTick = currentTick + durationTicks;
    if (!Number.isSafeInteger(nextActionTick)) {
      throw new RangeError(
        "Cooldown next action tick exceeds the safe integer range",
      );
    }
    this.nextTicksByPlayer.set(playerId, nextActionTick);
    return { playerId, nextActionTick };
  }

  /** Returns deterministic, serializable cooldown state. */
  toData(): PlayerCooldown[] {
    return [...this.nextTicksByPlayer.entries()]
      // Direct code-unit comparison is stable across runtimes and locales.
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([playerId, nextActionTick]) => ({ playerId, nextActionTick }));
  }

  private assertTick(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer`);
    }
  }
}
