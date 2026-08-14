import type {
  BattleCell,
  BattleParticipantId,
  BattleSnapshot,
} from "@grid-game/shared";

import type { BotBattleState } from "../src/Bot.ts";

export const ALPHA = 0;
export const BETA = 1;

export function createBattleSnapshot(options: Readonly<{
  tick?: number;
  cells?: BattleCell[];
  localStatus?: "active" | "withdrawn" | "eliminated";
}> = {}): BattleSnapshot {
  return {
    config: { ticksPerSecond: 20, splitDelayTicks: 10 },
    tick: options.tick ?? 0,
    status: { kind: "running" },
    participants: [
      { participantId: ALPHA, status: options.localStatus ?? "active" },
      { participantId: BETA, status: "active" },
    ],
    grid: {
      width: 3,
      height: 2,
      cells: options.cells ?? [
        { kind: "occupied", participantId: ALPHA, count: 1 },
        { kind: "empty" },
        { kind: "wall" },
        { kind: "occupied", participantId: ALPHA, count: 2 },
        { kind: "occupied", participantId: BETA, count: 1 },
        { kind: "empty" },
      ],
    },
    cooldowns: [],
    pendingSplits: [],
  };
}

export function createBotState(
  snapshot = createBattleSnapshot(),
  localParticipantId: BattleParticipantId = ALPHA,
): BotBattleState {
  return {
    snapshot,
    localParticipantId,
    estimatedTick: snapshot.tick,
    hasLocalCommandPending: false,
    latestRejection: null,
  };
}
