import type {
  BattleCell,
  BattleParticipantId,
  BattleSetup,
  PlayerId,
} from "@grid-game/shared";

/** Player identities available in the standalone demo. */
export const DEMO_PLAYERS = ["Blue", "Coral", "Gold"] as const;
export const DEMO_PARTICIPANT_IDS = [0, 1, 2] as const;
export const DEMO_ROSTER: ReadonlyMap<PlayerId, BattleParticipantId> = new Map([
  [DEMO_PLAYERS[0], DEMO_PARTICIPANT_IDS[0]],
  [DEMO_PLAYERS[1], DEMO_PARTICIPANT_IDS[1]],
  [DEMO_PLAYERS[2], DEMO_PARTICIPANT_IDS[2]],
]);

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

  cells[index(0, 0)] = { kind: "occupied", participantId: 0, count: 1 };
  cells[index(1, 1)] = { kind: "occupied", participantId: 0, count: 2 };
  cells[index(6, 0)] = { kind: "occupied", participantId: 1, count: 1 };
  cells[index(5, 1)] = { kind: "occupied", participantId: 1, count: 2 };
  cells[index(3, 6)] = { kind: "occupied", participantId: 2, count: 1 };
  cells[index(3, 4)] = { kind: "occupied", participantId: 2, count: 2 };

  return {
    participants: DEMO_PARTICIPANT_IDS.map((participantId) => ({
      participantId,
      status: "active" as const,
    })),
    grid: { width, height, cells },
  };
}
