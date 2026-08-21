import type {
  BattleParticipantId,
  Position,
} from "../domain/index.ts";
import type { BattleSnapshot } from "../domain/index.ts";

/** Inputs available when calculating an accepted command's cooldown. */
export type CooldownContext = {
  participantId: BattleParticipantId;
  /** One-based number of this participant's accepted player action. */
  acceptedActionCount: number;
  currentTick: number;
  position: Position;
  snapshot: BattleSnapshot;
};

/** Strategy for determining cooldown duration without coupling it to the engine. */
export interface CooldownPolicy {
  /** Returns a non-negative cooldown duration in simulation ticks. */
  durationTicks(context: CooldownContext): number;
}

/** Alternates short cooldowns with a long cooldown at each burst boundary. */
export class BurstCooldownPolicy implements CooldownPolicy {
  readonly shortDurationSeconds: number;
  readonly longDurationSeconds: number;
  readonly incrementsPerBurst: number;

  constructor(
    shortDurationSeconds: number,
    longDurationSeconds: number,
    incrementsPerBurst: number,
  ) {
    if (!Number.isFinite(shortDurationSeconds) || shortDurationSeconds < 0) {
      throw new RangeError("Short cooldown duration must be a non-negative finite number");
    }
    if (!Number.isFinite(longDurationSeconds) || longDurationSeconds < 0) {
      throw new RangeError("Long cooldown duration must be a non-negative finite number");
    }
    if (!Number.isSafeInteger(incrementsPerBurst) || incrementsPerBurst <= 0) {
      throw new RangeError("Increments per burst must be a positive safe integer");
    }
    this.shortDurationSeconds = shortDurationSeconds;
    this.longDurationSeconds = longDurationSeconds;
    this.incrementsPerBurst = incrementsPerBurst;
  }

  durationTicks(context: CooldownContext): number {
    if (!Number.isSafeInteger(context.acceptedActionCount) || context.acceptedActionCount <= 0) {
      throw new RangeError("Accepted action count must be a positive safe integer");
    }
    const seconds = context.acceptedActionCount % this.incrementsPerBurst === 0
      ? this.longDurationSeconds
      : this.shortDurationSeconds;
    const ticks = seconds * context.snapshot.config.ticksPerSecond;
    if (!Number.isSafeInteger(ticks) || ticks < 0) {
      throw new RangeError("Cooldown seconds must convert to a non-negative safe integer tick duration");
    }
    return ticks;
  }
}

/** Cooldown policy returning the same duration for every accepted action. */
export class FixedCooldownPolicy implements CooldownPolicy {
  /** Duration returned by this policy. */
  readonly fixedDurationTicks: number;

  /** Creates a fixed-duration policy. */
  constructor(durationTicks: number) {
    if (!Number.isSafeInteger(durationTicks) || durationTicks < 0) {
      throw new RangeError(
        "Cooldown duration must be a non-negative safe integer",
      );
    }
    this.fixedDurationTicks = durationTicks;
  }

  /** Returns the configured fixed duration. */
  durationTicks(_context: CooldownContext): number {
    return this.fixedDurationTicks;
  }
}
