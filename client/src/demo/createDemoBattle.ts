import type { BattleCell, BattleSetup } from "@grid-game/shared";

/** Player identities available in the standalone demo. */
export const DEMO_PLAYERS = ["Blue", "Coral", "Gold"] as const;

/** Creates a fresh, valid 7×7 setup for the local battle demo. */
export function createDemoBattle(): BattleSetup {
  const width = 7;
  const height = 7;
  const cells: BattleCell[] = Array.from(
    { length: width * height },
    (): BattleCell => ({ kind: "empty" }),
  );
  const index = (x: number, y: number) => y * width + x;

  // Walls shape propagation without isolating any playable square.
  for (const [x, y] of [
    [3, 1],
    [1, 3],
    [3, 3],
    [5, 3],
    [3, 5],
  ] as const) {
    cells[index(x, y)] = { kind: "wall" };
  }

  cells[index(0, 0)] = { kind: "occupied", playerId: "Blue", count: 1 };
  cells[index(1, 1)] = { kind: "occupied", playerId: "Blue", count: 2 };
  cells[index(6, 0)] = { kind: "occupied", playerId: "Coral", count: 1 };
  cells[index(5, 1)] = { kind: "occupied", playerId: "Coral", count: 2 };
  cells[index(3, 6)] = { kind: "occupied", playerId: "Gold", count: 1 };
  cells[index(3, 4)] = { kind: "occupied", playerId: "Gold", count: 2 };

  return {
    players: [...DEMO_PLAYERS],
    grid: { width, height, cells },
  };
}
