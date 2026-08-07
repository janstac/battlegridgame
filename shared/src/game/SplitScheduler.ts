import type { PendingSplit, Position } from "../domain/index.ts";

/** Maintains one delayed split per position in deterministic execution order. */
export class SplitScheduler {
  private readonly splitsByPosition = new Map<string, PendingSplit>();
  private nextSequence = 0;

  /** Restores a split queue and its sequence ordering. */
  constructor(initial: readonly PendingSplit[] = []) {
    const sequences = new Set<number>();
    for (const split of initial) {
      this.validateSplit(split);
      const key = this.positionKey(split.position);
      if (this.splitsByPosition.has(key)) {
        throw new Error(`Duplicate pending split at ${key}`);
      }
      if (sequences.has(split.sequence)) {
        throw new Error(`Duplicate pending split sequence ${split.sequence}`);
      }
      sequences.add(split.sequence);
      const copy = this.copySplit(split);
      this.splitsByPosition.set(key, copy);
      this.nextSequence = Math.max(this.nextSequence, split.sequence + 1);
    }
  }

  /** Returns whether a position already has a pending split. */
  has(position: Position): boolean {
    return this.splitsByPosition.has(this.positionKey(position));
  }

  /** Returns the pending split for a position, if present. */
  get(position: Position): PendingSplit | undefined {
    const split = this.splitsByPosition.get(this.positionKey(position));
    return split === undefined ? undefined : this.copySplit(split);
  }

  /** Schedules a position once and assigns its stable sequence number. */
  schedule(position: Position, dueTick: number): PendingSplit {
    this.validatePosition(position);
    const existing = this.get(position);
    if (existing !== undefined) {
      return existing;
    }
    if (!Number.isSafeInteger(dueTick) || dueTick < 0) {
      throw new RangeError("Split due tick must be a non-negative safe integer");
    }
    const split: PendingSplit = {
      position: { ...position },
      dueTick,
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.splitsByPosition.set(this.positionKey(position), split);
    return this.copySplit(split);
  }

  /** Removes a position's pending split. */
  cancel(position: Position): boolean {
    return this.splitsByPosition.delete(this.positionKey(position));
  }

  /** Removes and returns all due entries ordered by tick then sequence. */
  takeDue(currentTick: number): PendingSplit[] {
    if (!Number.isSafeInteger(currentTick) || currentTick < 0) {
      throw new RangeError("Current tick must be a non-negative safe integer");
    }
    const due = this.sortedData().filter((split) => split.dueTick <= currentTick);
    for (const split of due) {
      this.splitsByPosition.delete(this.positionKey(split.position));
    }
    return due;
  }

  /** Removes all scheduled splits. */
  clear(): void {
    this.splitsByPosition.clear();
  }

  /** Returns deterministic, serializable queue state. */
  toData(): PendingSplit[] {
    return this.sortedData();
  }

  private sortedData(): PendingSplit[] {
    return [...this.splitsByPosition.values()]
      .sort(
        (left, right) =>
          left.dueTick - right.dueTick || left.sequence - right.sequence,
      )
      .map((split) => this.copySplit(split));
  }

  private positionKey(position: Position): string {
    return `${position.x},${position.y}`;
  }

  private copySplit(split: PendingSplit): PendingSplit {
    return { ...split, position: { ...split.position } };
  }

  private validateSplit(split: PendingSplit): void {
    this.validatePosition(split.position);
    if (
      !Number.isSafeInteger(split.dueTick) ||
      split.dueTick < 0 ||
      !Number.isSafeInteger(split.sequence) ||
      split.sequence < 0
    ) {
      throw new RangeError(
        "Pending split tick and sequence must be non-negative safe integers",
      );
    }
  }

  private validatePosition(position: Position): void {
    if (
      !Number.isSafeInteger(position.x) ||
      position.x < 0 ||
      !Number.isSafeInteger(position.y) ||
      position.y < 0
    ) {
      throw new RangeError("Split position must contain non-negative safe integers");
    }
  }
}
