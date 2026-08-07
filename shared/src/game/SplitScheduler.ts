import type { PendingSplit, Position } from "../domain/index.ts";

/** Maintains one delayed split per position in deterministic execution order. */
export class SplitScheduler {
  /** Restores a split queue and its sequence ordering. */
  constructor(initial: readonly PendingSplit[] = []) {
    void initial;
  }

  /** Returns whether a position already has a pending split. */
  has(position: Position): boolean {
    void position;
    throw new Error("SplitScheduler.has is not implemented yet");
  }

  /** Returns the pending split for a position, if present. */
  get(position: Position): PendingSplit | undefined {
    void position;
    throw new Error("SplitScheduler.get is not implemented yet");
  }

  /** Schedules a position once and assigns its stable sequence number. */
  schedule(position: Position, dueTick: number): PendingSplit {
    void position;
    void dueTick;
    throw new Error("SplitScheduler.schedule is not implemented yet");
  }

  /** Removes a position's pending split. */
  cancel(position: Position): boolean {
    void position;
    throw new Error("SplitScheduler.cancel is not implemented yet");
  }

  /** Removes and returns all due entries ordered by tick then sequence. */
  takeDue(currentTick: number): PendingSplit[] {
    void currentTick;
    throw new Error("SplitScheduler.takeDue is not implemented yet");
  }

  /** Removes all scheduled splits. */
  clear(): void {
    throw new Error("SplitScheduler.clear is not implemented yet");
  }

  /** Returns deterministic, serializable queue state. */
  toData(): PendingSplit[] {
    throw new Error("SplitScheduler.toData is not implemented yet");
  }
}
