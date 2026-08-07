import type {
  BattleCell,
  BattleSetup,
  BattleSnapshot,
  PlayerId,
  Position,
  SerializedGrid,
} from "../src/domain/index.ts";

/** Stable first-player identifier used throughout shared-engine tests. */
export const ALPHA: PlayerId = "alpha";

/** Stable second-player identifier used throughout shared-engine tests. */
export const BETA: PlayerId = "beta";

/** Creates a fresh empty battle cell. */
export function empty(): BattleCell {
  return { kind: "empty" };
}

/** Creates a fresh wall battle cell. */
export function wall(): BattleCell {
  return { kind: "wall" };
}

/** Creates a fresh occupied battle cell. */
export function occupied(playerId: PlayerId, count: number): BattleCell {
  return { kind: "occupied", playerId, count };
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

/** Builds a valid two-player battle setup around supplied grid data. */
export function makeSetup(
  grid: SerializedGrid<BattleCell>,
  battleId = "test-battle",
): BattleSetup {
  return { battleId, players: [ALPHA, BETA], grid };
}

/** Builds a restorable running snapshot with explicit queued splits. */
export function makeSnapshot(
  grid: SerializedGrid<BattleCell>,
  options: Partial<
    Pick<
      BattleSnapshot,
      "battleId" | "tick" | "revision" | "status" | "cooldowns" | "pendingSplits"
    >
  > = {},
): BattleSnapshot {
  return {
    battleId: options.battleId ?? "test-battle",
    tick: options.tick ?? 0,
    revision: options.revision ?? 0,
    status: options.status ?? { kind: "running" },
    players: [ALPHA, BETA],
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
