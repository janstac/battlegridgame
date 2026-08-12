import {
  FixedGrid,
  copyWorldCell,
  parseWorldCell,
  type BattleId,
  type ChallengeId,
  type PlayerId,
  type Position,
  type WorldCell,
  type WorldDelta,
  type WorldRevision,
  type WorldSnapshot,
} from "@grid-game/shared";

export const DEFAULT_WORLD_WIDTH = 10;
export const DEFAULT_WORLD_HEIGHT = 10;
export const DEFAULT_INITIAL_CELL_COUNT = 2;

/** Supplies independent samples in the half-open interval [0, 1). */
export interface RandomSource {
  next(): number;
}

const SYSTEM_RANDOM: RandomSource = { next: () => Math.random() };

/** A compare-and-set precondition for one World cell. */
export type WorldCellExpectation =
  | Readonly<{ kind: "unoccupied" }>
  | Readonly<{ kind: "occupied"; playerId?: PlayerId }>
  | Readonly<{ kind: "challengePending"; challengeId?: ChallengeId }>
  | Readonly<{ kind: "battle"; battleId?: BattleId }>;

/** One member of an atomic World mutation batch. */
export type WorldCellReplacement = Readonly<{
  position: Position;
  expected: WorldCellExpectation;
  cell: WorldCell;
}>;

export interface WorldOptions {
  width?: number;
  height?: number;
  random?: RandomSource;
}

/** Raised when a cell changed between inspection and an attempted mutation. */
export class WorldCellConflictError extends Error {
  readonly position: Position;
  readonly expected: WorldCellExpectation;
  readonly actual: WorldCell;

  constructor(
    position: Position,
    expected: WorldCellExpectation,
    actual: WorldCell,
  ) {
    super(
      `World cell (${position.x}, ${position.y}) did not match expected ${expected.kind}`,
    );
    this.name = "WorldCellConflictError";
    this.position = { ...position };
    this.expected = { ...expected };
    this.actual = copyWorldCell(actual);
  }
}

/** Raised when one live challenge or battle is assigned to multiple cells. */
export class WorldRuntimeIndexConflictError extends Error {
  constructor(kind: "challenge" | "battle", id: string) {
    super(`World ${kind} ${id} is already assigned to another cell`);
    this.name = "WorldRuntimeIndexConflictError";
  }
}

/**
 * Process-local authoritative fixed World.
 *
 * Mutation methods are synchronous. A batch validates every precondition before
 * changing any cell, advances the revision exactly once, and publishes one
 * complete delta after the commit.
 */
export class World {
  private readonly grid: FixedGrid<WorldCell>;
  private readonly random: RandomSource;
  private readonly listeners = new Set<(delta: WorldDelta) => void>();
  private readonly challenges = new Map<ChallengeId, Position>();
  private readonly battles = new Map<BattleId, Position>();
  private worldRevision: WorldRevision = 0;

  constructor(options: WorldOptions = {}) {
    this.random = options.random ?? SYSTEM_RANDOM;
    this.grid = new FixedGrid<WorldCell>(
      options.width ?? DEFAULT_WORLD_WIDTH,
      options.height ?? DEFAULT_WORLD_HEIGHT,
      () => ({ kind: "unoccupied" }),
    );
  }

  get width(): number { return this.grid.width; }
  get height(): number { return this.grid.height; }
  get revision(): WorldRevision { return this.worldRevision; }

  /** Returns an independent copy of the current cell. */
  cellAt(position: Position): WorldCell {
    return copyWorldCell(this.grid.get(position));
  }

  /** Returns an independent complete public snapshot. */
  snapshot(): WorldSnapshot {
    return {
      revision: this.worldRevision,
      grid: this.grid.toData(copyWorldCell),
    };
  }

  /** Looks up the cell occupied by a particular pending challenge. */
  positionForChallenge(challengeId: ChallengeId): Position | undefined {
    const position = this.challenges.get(challengeId);
    return position === undefined ? undefined : { ...position };
  }

  /** Looks up the cell occupied by a particular live battle. */
  positionForBattle(battleId: BattleId): Position | undefined {
    const position = this.battles.get(battleId);
    return position === undefined ? undefined : { ...position };
  }

  /** Subscribes to future committed deltas. The current snapshot is not emitted. */
  subscribe(listener: (delta: WorldDelta) => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  /** Atomically replaces one cell if its precondition still holds. */
  replaceCell(
    position: Position,
    expected: WorldCellExpectation,
    cell: WorldCell,
  ): WorldDelta {
    const delta = this.replaceCells([{ position, expected, cell }]);
    if (delta === null) throw new Error("Single-cell replacement unexpectedly produced no delta");
    return delta;
  }

  /**
   * Applies an all-or-nothing compare-and-set batch.
   *
   * Empty batches return null and do not advance the revision.
   */
  replaceCells(replacements: readonly WorldCellReplacement[]): WorldDelta | null {
    if (replacements.length === 0) return null;
    if (this.worldRevision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("World revision cannot be advanced safely");
    }

    const seenPositions = new Set<string>();
    const prepared = replacements.map((replacement) => {
      const position = { ...replacement.position };
      const key = positionKey(position);
      if (seenPositions.has(key)) {
        throw new RangeError(`World mutation contains duplicate position ${key}`);
      }
      seenPositions.add(key);

      const actual = this.grid.get(position);
      if (!matchesExpectation(actual, replacement.expected)) {
        throw new WorldCellConflictError(position, replacement.expected, actual);
      }
      const cell = copyWorldCell(parseWorldCell(replacement.cell));
      return { position, actual, cell };
    });

    const nextChallenges = new Map(this.challenges);
    const nextBattles = new Map(this.battles);
    for (const replacement of prepared) {
      removeRuntimeIndex(nextChallenges, nextBattles, replacement.actual);
    }
    for (const replacement of prepared) {
      addRuntimeIndex(
        nextChallenges,
        nextBattles,
        replacement.position,
        replacement.cell,
      );
    }

    const fromRevision = this.worldRevision;
    const revision = fromRevision + 1;
    for (const replacement of prepared) {
      this.grid.set(replacement.position, replacement.cell);
    }
    this.challenges.clear();
    this.battles.clear();
    for (const [id, position] of nextChallenges) this.challenges.set(id, position);
    for (const [id, position] of nextBattles) this.battles.set(id, position);
    this.worldRevision = revision;

    const delta: WorldDelta = {
      fromRevision,
      revision,
      changes: prepared.map(({ position, cell }) => ({
        position: { ...position },
        cell: copyWorldCell(cell),
      })),
    };
    this.publish(delta);
    return copyDelta(delta);
  }

  /**
   * Uniformly selects and atomically occupies up to `count` distinct free cells.
   */
  allocateUnoccupiedCells(
    playerId: PlayerId,
    count = DEFAULT_INITIAL_CELL_COUNT,
  ): readonly Position[] {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("Allocation count must be a non-negative safe integer");
    }
    if (count === 0) return [];

    const available: Position[] = [];
    for (const [position, cell] of this.grid.entries()) {
      if (cell.kind === "unoccupied") available.push(position);
    }
    const selectedCount = Math.min(count, available.length);
    for (let index = 0; index < selectedCount; index += 1) {
      const sample = this.random.next();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError("RandomSource.next() must return a number in [0, 1)");
      }
      const selectedIndex = index + Math.floor(sample * (available.length - index));
      [available[index], available[selectedIndex]] = [
        available[selectedIndex] as Position,
        available[index] as Position,
      ];
    }
    const positions = available.slice(0, selectedCount).map((position) => ({ ...position }));
    this.replaceCells(positions.map((position) => ({
      position,
      expected: { kind: "unoccupied" },
      cell: { kind: "occupied", playerId },
    })));
    return positions;
  }

  /** Clears all ordinary occupied cells belonging to a disconnected player. */
  clearOccupiedCells(playerId: PlayerId): readonly Position[] {
    const positions: Position[] = [];
    for (const [position, cell] of this.grid.entries()) {
      if (cell.kind === "occupied" && cell.playerId === playerId) {
        positions.push(position);
      }
    }
    this.replaceCells(positions.map((position) => ({
      position,
      expected: { kind: "occupied", playerId },
      cell: { kind: "unoccupied" },
    })));
    return positions.map((position) => ({ ...position }));
  }

  private publish(delta: WorldDelta): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(copyDelta(delta));
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function matchesExpectation(cell: WorldCell, expected: WorldCellExpectation): boolean {
  if (cell.kind !== expected.kind) return false;
  switch (expected.kind) {
    case "unoccupied":
      return true;
    case "occupied":
      return expected.playerId === undefined
        || (cell.kind === "occupied" && cell.playerId === expected.playerId);
    case "challengePending":
      return expected.challengeId === undefined
        || (cell.kind === "challengePending" && cell.challengeId === expected.challengeId);
    case "battle":
      return expected.battleId === undefined
        || (cell.kind === "battle" && cell.battleId === expected.battleId);
  }
}

function removeRuntimeIndex(
  challenges: Map<ChallengeId, Position>,
  battles: Map<BattleId, Position>,
  cell: WorldCell,
): void {
  if (cell.kind === "challengePending") challenges.delete(cell.challengeId);
  if (cell.kind === "battle") battles.delete(cell.battleId);
}

function addRuntimeIndex(
  challenges: Map<ChallengeId, Position>,
  battles: Map<BattleId, Position>,
  position: Position,
  cell: WorldCell,
): void {
  if (cell.kind === "challengePending") {
    if (challenges.has(cell.challengeId)) {
      throw new WorldRuntimeIndexConflictError("challenge", cell.challengeId);
    }
    challenges.set(cell.challengeId, { ...position });
  }
  if (cell.kind === "battle") {
    if (battles.has(cell.battleId)) {
      throw new WorldRuntimeIndexConflictError("battle", cell.battleId);
    }
    battles.set(cell.battleId, { ...position });
  }
}

function copyDelta(delta: WorldDelta): WorldDelta {
  return {
    fromRevision: delta.fromRevision,
    revision: delta.revision,
    changes: delta.changes.map((change) => ({
      position: { ...change.position },
      cell: copyWorldCell(change.cell),
    })),
  };
}
