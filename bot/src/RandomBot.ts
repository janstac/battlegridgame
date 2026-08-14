import { SAFE_INTEGER_MAX, type Position } from "@grid-game/shared";

import type { Bot, BotAction, BotBattleState } from "./Bot.ts";

export type RandomSource = () => number;

/** Chooses uniformly from incrementable cells owned by the local participant. */
export class RandomBot implements Bot {
  private readonly random: RandomSource;

  constructor(random: RandomSource = Math.random) {
    this.random = random;
  }

  decide(state: BotBattleState): BotAction | null {
    const positions: Position[] = [];
    const { width, cells } = state.snapshot.grid;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (
        cell?.kind === "occupied"
        && cell.participantId === state.localParticipantId
        && cell.count < SAFE_INTEGER_MAX
      ) {
        positions.push({ x: index % width, y: Math.floor(index / width) });
      }
    }
    if (positions.length === 0) return null;

    const sample = this.random();
    const bounded = Number.isFinite(sample)
      ? Math.max(0, Math.min(sample, 1 - Number.EPSILON))
      : 0;
    const position = positions[Math.floor(bounded * positions.length)];
    return position === undefined
      ? null
      : { type: "incrementCell", position };
  }
}
