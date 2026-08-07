import type { PlayerCooldown, PlayerId } from "../domain/index.ts";

/** Tracks per-player action availability for one battle. */
export class CooldownTracker {
  /** Restores cooldown state from optional serialized entries. */
  constructor(initial: readonly PlayerCooldown[] = []) {
    void initial;
  }

  /** Returns whether a player may act at the supplied tick. */
  canAct(playerId: PlayerId, currentTick: number): boolean {
    void playerId;
    void currentTick;
    throw new Error("CooldownTracker.canAct is not implemented yet");
  }

  /** Returns the first tick at which a player may act. */
  nextActionTick(playerId: PlayerId): number {
    void playerId;
    throw new Error("CooldownTracker.nextActionTick is not implemented yet");
  }

  /** Returns the non-negative wait remaining at the supplied tick. */
  remainingTicks(playerId: PlayerId, currentTick: number): number {
    void playerId;
    void currentTick;
    throw new Error("CooldownTracker.remainingTicks is not implemented yet");
  }

  /** Starts or replaces a player's cooldown and returns its serialized form. */
  start(
    playerId: PlayerId,
    currentTick: number,
    durationTicks: number,
  ): PlayerCooldown {
    void playerId;
    void currentTick;
    void durationTicks;
    throw new Error("CooldownTracker.start is not implemented yet");
  }

  /** Returns deterministic, serializable cooldown state. */
  toData(): PlayerCooldown[] {
    throw new Error("CooldownTracker.toData is not implemented yet");
  }
}
