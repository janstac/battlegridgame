import type {
  BattleCell,
  BattleParticipantId,
  BattleSetup,
  BattleSnapshot,
  Position,
  SerializedGrid,
} from "../src/domain/index.ts";

/** Stable first-participant identifier used throughout shared-engine tests. */
export const ALPHA: BattleParticipantId = 0;

/** Stable second-participant identifier used throughout shared-engine tests. */
export const BETA: BattleParticipantId = 1;

/** Creates a fresh empty battle cell. */
export function empty(): BattleCell {
  return { kind: "empty" };
}

/** Creates a fresh wall battle cell. */
export function wall(): BattleCell {
  return { kind: "wall" };
}

/** Creates a fresh occupied battle cell. */
export function occupied(
  participantId: BattleParticipantId,
  count: number,
): BattleCell {
  return { kind: "occupied", participantId, count };
}

/** Converts a zero-based coordinate to its row-major array index. */
export function indexAt(width: number, position: Position): number {
  return position.y * width + position.x;
}

/** Builds plain row-major grid data with optional position overrides. */
export function makeGrid(
  width: number,
  height: number,
  overrides: ReadonlyArray<readonly [Position, BattleCell]> = [],
): SerializedGrid<BattleCell> {
  const cells = Array.from({ length: width * height }, empty);

  for (const [position, cell] of overrides) {
    cells[indexAt(width, position)] = structuredClone(cell);
  }

  return { width, height, cells };
}

/** Builds a valid two-participant battle setup around supplied grid data. */
export function makeSetup(
  grid: SerializedGrid<BattleCell>,
): BattleSetup {
  return {
    participants: [
      { participantId: ALPHA, status: "active" },
      { participantId: BETA, status: "active" },
    ],
    grid,
  };
}

/** Builds a restorable running snapshot with explicit queued splits. */
export function makeSnapshot(
  grid: SerializedGrid<BattleCell>,
  options: Partial<
    Pick<
      BattleSnapshot,
      "config" | "tick" | "status" | "cooldowns" | "pendingSplits"
    >
  > = {},
): BattleSnapshot {
  return {
    config: options.config ?? { ticksPerSecond: 20, splitDelayTicks: 10 },
    tick: options.tick ?? 0,
    status: options.status ?? { kind: "running" },
    participants: [
      { participantId: ALPHA, status: "active" },
      { participantId: BETA, status: "active" },
    ],
    grid,
    cooldowns: options.cooldowns ?? [],
    pendingSplits: options.pendingSplits ?? [],
  };
}

/** Reads a cell from serialized grid data and asserts its presence by type. */
export function cellAt(
  grid: SerializedGrid<BattleCell>,
  position: Position,
): BattleCell {
  const cell = grid.cells[indexAt(grid.width, position)];
  if (cell === undefined) {
    throw new Error(`Missing test cell at (${position.x}, ${position.y})`);
  }
  return cell;
}
