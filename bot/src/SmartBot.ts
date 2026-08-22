import {
  BattleEngine,
  BurstCooldownPolicy,
  SAFE_INTEGER_MAX,
  type BattleCell,
  type BattleParticipantId,
  type BattleSnapshot,
  type CooldownPolicy,
  type Position,
} from "@grid-game/shared";

import type { Bot, BotAction, BotBattleState } from "./Bot.ts";

const DEFAULT_MAX_CANDIDATES = 6;
const DEFAULT_MAX_PROJECTION_TICKS = 140;
const WIN_SCORE = 1_000_000;
const ILLEGAL_SCORE = -Number.MAX_SAFE_INTEGER;

/** Current standard-server cooldown profile. Override for non-standard battles. */
export function createStandardBotCooldownPolicy(): CooldownPolicy {
  return new BurstCooldownPolicy(1, 5, 3);
}

export type SmartBotOptions = Readonly<{
  cooldownPolicy?: CooldownPolicy;
  maxCandidates?: number;
  maxProjectionTicks?: number;
}>;

type RankedMove = Readonly<{
  position: Position;
  quickScore: number;
  index: number;
}>;

/**
 * Bounded one-ply bot.
 *
 * It cheaply ranks every legal increment, then uses the authoritative engine to
 * project only the best few moves through deterministic split/chain events.
 * There is deliberately no opponent-response tree: cooldown exposure is scored
 * from authoritative readiness instead, keeping decision cost predictable.
 */
export class SmartBot implements Bot {
  private readonly cooldownPolicy: CooldownPolicy;
  private readonly maxCandidates: number;
  private readonly maxProjectionTicks: number;

  constructor(options: SmartBotOptions = {}) {
    this.cooldownPolicy = options.cooldownPolicy ?? createStandardBotCooldownPolicy();
    this.maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    this.maxProjectionTicks = options.maxProjectionTicks ?? DEFAULT_MAX_PROJECTION_TICKS;
    if (!Number.isSafeInteger(this.maxCandidates) || this.maxCandidates <= 0) {
      throw new RangeError("SmartBot maxCandidates must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxProjectionTicks) || this.maxProjectionTicks < 0) {
      throw new RangeError("SmartBot maxProjectionTicks must be a non-negative safe integer");
    }
  }

  decide(state: BotBattleState): BotAction | null {
    const ranked = this.rankMoves(state.snapshot, state.localParticipantId);
    if (ranked.length === 0) return null;

    const candidates = ranked.slice(0, this.maxCandidates);
    let best = candidates[0];
    let bestScore = ILLEGAL_SCORE;

    for (const candidate of candidates) {
      const projected = this.projectMove(state, candidate.position);
      const score = projected ?? candidate.quickScore;
      if (
        best === undefined
        || score > bestScore
        || (score === bestScore && candidate.quickScore > best.quickScore)
      ) {
        best = candidate;
        bestScore = score;
      }
    }

    return best === undefined
      ? null
      : { type: "incrementCell", position: best.position };
  }

  private rankMoves(
    snapshot: BattleSnapshot,
    localParticipantId: BattleParticipantId,
  ): RankedMove[] {
    const pending = new Set(snapshot.pendingSplits.map(({ position }) => positionKey(position)));
    const ranked: RankedMove[] = [];
    const { width, cells } = snapshot.grid;

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (
        cell?.kind !== "occupied"
        || cell.participantId !== localParticipantId
        || cell.count >= SAFE_INTEGER_MAX
      ) continue;

      const position = positionAt(index, width);
      const threshold = thresholdAt(snapshot, position);
      if (threshold === 0) continue;
      const afterCount = cell.count + 1;
      const willSplit = afterCount >= threshold;
      let score = 0;

      // Extra mass on an already-scheduled source disappears when it splits.
      if (pending.has(positionKey(position))) score -= 10_000;
      if (willSplit) score += 800;
      score += Math.max(0, 5 - (threshold - cell.count)) * 18;

      for (const neighbour of neighbours(snapshot, position)) {
        const adjacent = cellAt(snapshot, neighbour);
        if (adjacent.kind === "empty") {
          score += willSplit ? 24 : 3;
          continue;
        }
        if (adjacent.kind !== "occupied") continue;
        const adjacentThreshold = thresholdAt(snapshot, neighbour);
        if (adjacent.participantId === localParticipantId) {
          if (willSplit && adjacent.count + 1 >= adjacentThreshold) score += 90;
          continue;
        }
        score += 35;
        if (willSplit) {
          score += 130;
          if (pending.has(positionKey(neighbour))) score += 260;
          if (adjacent.count + 1 >= adjacentThreshold) score += 220;
        }
      }

      ranked.push({ position, quickScore: score, index });
    }

    ranked.sort((left, right) =>
      right.quickScore - left.quickScore || left.index - right.index
    );
    return ranked;
  }

  private projectMove(state: BotBattleState, position: Position): number | null {
    const snapshot = state.snapshot;
    const catchUpTicks = Math.max(0, state.estimatedTick - snapshot.tick);
    if (catchUpTicks > this.maxProjectionTicks) return null;

    let engine: BattleEngine;
    try {
      engine = BattleEngine.restore(snapshot, this.cooldownPolicy);
      for (let tick = 0; tick < catchUpTicks && engine.status.kind === "running"; tick += 1) {
        engine.advanceTick();
      }

      if (engine.status.kind !== "running") {
        return this.evaluate(engine.getSnapshot(), state.localParticipantId, engine.currentTick);
      }

      const result = engine.applyCommand(
        { participantId: state.localParticipantId },
        { kind: "incrementCell", position },
      );
      if (!result.accepted) return ILLEGAL_SCORE;
    } catch {
      // A strategy must stay useful even when connected to a battle whose
      // cooldown policy does not match the configured simulation policy.
      return null;
    }

    const commandTick = engine.currentTick;
    const afterCommand = engine.getSnapshot();
    const localCooldown = afterCommand.cooldowns.find(
      ({ participantId }) => participantId === state.localParticipantId,
    );
    const nextActionTick = localCooldown?.nextActionTick ?? commandTick;
    const projectionEnd = Math.min(
      nextActionTick,
      commandTick + this.maxProjectionTicks,
    );

    while (engine.currentTick < projectionEnd && engine.status.kind === "running") {
      engine.advanceTick();
    }

    const projected = engine.getSnapshot();
    let score = this.evaluate(projected, state.localParticipantId, engine.currentTick);
    score -= this.cooldownExposurePenalty(
      afterCommand,
      state.localParticipantId,
      commandTick,
      nextActionTick,
    );
    return score;
  }

  private evaluate(
    snapshot: BattleSnapshot,
    localParticipantId: BattleParticipantId,
    tick: number,
  ): number {
    if (snapshot.status.kind === "finished") {
      return snapshot.status.winnerId === localParticipantId ? WIN_SCORE : -WIN_SCORE;
    }

    let score = 0;
    const pendingByPosition = new Map(
      snapshot.pendingSplits.map((split) => [positionKey(split.position), split] as const),
    );

    for (let index = 0; index < snapshot.grid.cells.length; index += 1) {
      const cell = snapshot.grid.cells[index];
      if (cell?.kind !== "occupied") continue;
      const position = positionAt(index, snapshot.grid.width);
      const mine = cell.participantId === localParticipantId;
      const sign = mine ? 1 : -1;
      const threshold = thresholdAt(snapshot, position);
      if (threshold === 0) continue;

      score += sign * 110;
      score += sign * Math.min(cell.count, threshold) * 10;
      score += sign * Math.round(35 * Math.min(cell.count / threshold, 1));
      if (cell.count + 1 >= threshold) score += sign * 24;

      const pendingSplit = pendingByPosition.get(positionKey(position));
      if (pendingSplit !== undefined) {
        let bombValue = 45;
        for (const neighbour of neighbours(snapshot, position)) {
          const adjacent = cellAt(snapshot, neighbour);
          if (adjacent.kind === "empty") {
            bombValue += 8;
          } else if (adjacent.kind === "occupied" && adjacent.participantId !== cell.participantId) {
            bombValue += 55;
            if (adjacent.count + 1 >= thresholdAt(snapshot, neighbour)) bombValue += 70;
          }
        }
        const remaining = Math.max(0, pendingSplit.dueTick - tick);
        bombValue += Math.max(0, snapshot.config.splitDelayTicks - remaining);
        score += sign * bombValue;
      }
    }

    return score;
  }

  private cooldownExposurePenalty(
    snapshot: BattleSnapshot,
    localParticipantId: BattleParticipantId,
    currentTick: number,
    localNextActionTick: number,
  ): number {
    if (localNextActionTick <= currentTick) return 0;
    let exposure = 0;

    for (const participant of snapshot.participants) {
      if (participant.status !== "active" || participant.participantId === localParticipantId) {
        continue;
      }
      const opponentNextActionTick = snapshot.cooldowns.find(
        ({ participantId }) => participantId === participant.participantId,
      )?.nextActionTick ?? currentTick;
      const responseWindow = Math.max(
        0,
        localNextActionTick - Math.max(currentTick, opponentNextActionTick),
      );
      exposure += responseWindow * 2;
    }

    return exposure;
  }
}

function positionAt(index: number, width: number): Position {
  return { x: index % width, y: Math.floor(index / width) };
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function cellAt(snapshot: BattleSnapshot, position: Position): BattleCell {
  const index = position.y * snapshot.grid.width + position.x;
  const cell = snapshot.grid.cells[index];
  if (cell === undefined) throw new RangeError("Battle position is outside the grid");
  return cell;
}

function neighbours(snapshot: BattleSnapshot, position: Position): Position[] {
  const candidates = [
    { x: position.x, y: position.y - 1 },
    { x: position.x + 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x - 1, y: position.y },
  ];
  return candidates.filter((candidate) =>
    candidate.x >= 0
    && candidate.y >= 0
    && candidate.x < snapshot.grid.width
    && candidate.y < snapshot.grid.height
    && cellAt(snapshot, candidate).kind !== "wall"
  );
}

function thresholdAt(snapshot: BattleSnapshot, position: Position): number {
  return neighbours(snapshot, position).length;
}
