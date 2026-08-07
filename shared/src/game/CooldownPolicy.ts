import type {
  BattleSnapshot,
  PlayerId,
  Position,
} from "../domain/index.ts";

/** Inputs available when calculating an accepted command's cooldown. */
export type CooldownContext = {
  playerId: PlayerId;
  currentTick: number;
  position: Position;
  snapshot: BattleSnapshot;
};

/** Strategy for determining cooldown duration without coupling it to the engine. */
export interface CooldownPolicy {
  /** Returns a non-negative cooldown duration in simulation ticks. */
  durationTicks(context: CooldownContext): number;
}

/** Cooldown policy returning the same duration for every accepted action. */
export class FixedCooldownPolicy implements CooldownPolicy {
  /** Duration returned by this policy. */
  readonly fixedDurationTicks: number;

  /** Creates a fixed-duration policy. */
  constructor(durationTicks: number) {
    this.fixedDurationTicks = durationTicks;
  }

  /** Returns the configured fixed duration. */
  durationTicks(_context: CooldownContext): number {
    return this.fixedDurationTicks;
  }
}
