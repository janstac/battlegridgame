import {
  BattleState,
  type BattleCell,
  type BattleConfig,
  type BattleSetup,
  type BattleSnapshot,
  type BattleStatus,
  type PendingSplit,
  type PlayerId,
  type Position,
} from "../domain/index.ts";
import type { BattleCommand, CommandContext } from "./commands.ts";
import type { CooldownPolicy } from "./CooldownPolicy.ts";
import type { BattleEvent, CommandResult, TickResult } from "./events.ts";

/** Authoritative deterministic rules for a single isolated battle. */
export class BattleEngine {
  private state: BattleState;
  private readonly cooldownPolicy: CooldownPolicy;
  private nextSplitSequence: number | null;
  private dueSplitPositions = new Set<string>();

  private constructor(state: BattleState, cooldownPolicy: CooldownPolicy) {
    this.state = state;
    this.cooldownPolicy = cooldownPolicy;
    this.nextSplitSequence = this.findNextSplitSequence();
  }

  /** Creates an engine from battle setup and immutable battle configuration. */
  static create(
    setup: BattleSetup,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    BattleEngine.assertConfig(config);
    const engine = new BattleEngine(
      BattleState.create(setup, config),
      cooldownPolicy,
    );
    engine.assertStateIsValid(true);
    // Counts at or above threshold in supplied setup must not become inert.
    for (const [position] of engine.state.entries()) {
      engine.scheduleIfEligible(position);
    }
    return engine;
  }

  /** Restores an engine from a complete authoritative snapshot. */
  static restore(
    snapshot: BattleSnapshot,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    BattleEngine.assertConfig(snapshot.config);
    const engine = new BattleEngine(BattleState.restore(snapshot), cooldownPolicy);
    engine.assertStateIsValid(false);
    return engine;
  }

  get currentTick(): number {
    return this.state.tick;
  }

  get status(): BattleStatus {
    return this.state.status;
  }

  /** Returns an independent plain-data snapshot of authoritative state. */
  getSnapshot(): BattleSnapshot {
    return this.state.toSnapshot();
  }

  /** Validates and applies one command without advancing simulation time. */
  applyCommand(context: CommandContext, command: BattleCommand): CommandResult {
    return this.runAtomically(() => {
      const commandKind = (command as { kind?: unknown } | null)?.kind;
      switch (commandKind) {
        case "incrementCell":
          return this.applyIncrementCommand(context, command);
        default:
          throw new TypeError(
            `Unsupported battle command kind: ${String(commandKind)}`,
          );
      }
    });
  }

  private applyIncrementCommand(
    context: CommandContext,
    command: BattleCommand,
  ): CommandResult {
    if (this.state.status.kind === "finished") {
      return { accepted: false, reason: "battleFinished" };
    }
    if (!this.state.players.includes(context.playerId)) {
      return { accepted: false, reason: "unknownPlayer" };
    }
    if (!this.state.contains(command.position)) {
      return { accepted: false, reason: "outOfBounds" };
    }
    const cell = this.state.cellAt(command.position);
    if (cell.kind !== "occupied") {
      return { accepted: false, reason: "notOccupied" };
    }
    if (cell.playerId !== context.playerId) {
      return { accepted: false, reason: "notOwner" };
    }
    if (
      this.state.tick <
      (this.state.cooldownFor(context.playerId)?.nextActionTick ?? 0)
    ) {
      return { accepted: false, reason: "cooldownActive" };
    }

    const durationTicks = this.cooldownPolicy.durationTicks({
      playerId: context.playerId,
      currentTick: this.state.tick,
      position: { ...command.position },
      snapshot: this.getSnapshot(),
    });
    BattleEngine.assertNonNegativeInteger(durationTicks, "Cooldown duration");
    const nextActionTick = this.state.tick + durationTicks;
    BattleEngine.assertNonNegativeInteger(
      nextActionTick,
      "Cooldown next action tick",
    );

    const events = this.applyIncrement(context.playerId, command.position);
    this.state.replaceCooldown({
      playerId: context.playerId,
      nextActionTick,
    });
    events.push({
      kind: "cooldownStarted",
      playerId: context.playerId,
      nextActionTick,
    });
    return { accepted: true, events };
  }

  /** Advances one tick and resolves splits due in stable queue order. */
  advanceTick(): TickResult {
    if (this.state.status.kind === "finished") {
      return { tick: this.state.tick, events: [] };
    }
    return this.runAtomically(() => {
      if (this.state.tick === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Battle tick exceeds the safe integer range");
      }
      this.state.setTick(this.state.tick + 1);
      const events: BattleEvent[] = [];
      const dueSplits = this.takeDueSplits();
      for (const pending of dueSplits) {
        this.dueSplitPositions.add(this.positionKey(pending.position));
      }

      for (const pending of dueSplits) {
        this.dueSplitPositions.delete(this.positionKey(pending.position));
        events.push(...this.resolveSplit(pending));
        const won = this.finishIfWon();
        if (won !== undefined) {
          events.push(won);
          this.state.clearPendingSplits();
          this.dueSplitPositions.clear();
          break;
        }
      }
      this.dueSplitPositions.clear();
      return { tick: this.state.tick, events };
    });
  }

  private runAtomically<T>(operation: () => T): T {
    const checkpoint = this.state.clone();
    const nextSplitSequence = this.nextSplitSequence;
    const dueSplitPositions = new Set(this.dueSplitPositions);
    try {
      return operation();
    } catch (error) {
      this.state = checkpoint;
      this.nextSplitSequence = nextSplitSequence;
      this.dueSplitPositions = dueSplitPositions;
      throw error;
    }
  }

  private applyIncrement(playerId: PlayerId, position: Position): BattleEvent[] {
    const cell = this.state.cellAt(position);
    if (cell.kind !== "occupied" || cell.playerId !== playerId) {
      throw new Error("Internal increment precondition failed");
    }
    const nextCount = cell.count + 1;
    this.assertCount(nextCount);
    this.state.replaceCell(position, { kind: "occupied", playerId, count: nextCount });
    const events: BattleEvent[] = [{
      kind: "cellIncremented",
      position: { ...position },
      playerId,
      previousCount: cell.count,
      nextCount,
      source: "command",
    }];
    const scheduled = this.scheduleIfEligible(position);
    if (scheduled !== undefined) events.push(scheduled);
    return events;
  }

  private resolveSplit(pending: PendingSplit): BattleEvent[] {
    const source = this.state.cellAt(pending.position);
    if (source.kind !== "occupied") return [];

    const events: BattleEvent[] = [{
      kind: "cellSplit",
      position: { ...pending.position },
      playerId: source.playerId,
      count: source.count,
    }];
    this.state.replaceCell(pending.position, { kind: "empty" });

    for (const position of this.state.orthogonalNeighbours(pending.position)) {
      if (this.state.cellAt(position).kind !== "wall") {
        events.push(...this.incrementFromSplit(position, source.playerId));
      }
    }
    return events;
  }

  private incrementFromSplit(position: Position, playerId: PlayerId): BattleEvent[] {
    const previous = this.state.cellAt(position);
    if (previous.kind === "wall") return [];
    const previousCount = previous.kind === "occupied" ? previous.count : 0;
    const nextCount = previousCount + 1;
    this.assertCount(nextCount);
    this.state.replaceCell(position, { kind: "occupied", playerId, count: nextCount });

    const events: BattleEvent[] = previous.kind === "occupied" && previous.playerId === playerId
      ? [{
          kind: "cellIncremented",
          position: { ...position },
          playerId,
          previousCount,
          nextCount,
          source: "split",
        }]
      : [{
          kind: "cellCaptured",
          position: { ...position },
          playerId,
          previousPlayerId: previous.kind === "occupied" ? previous.playerId : null,
          previousCount,
          nextCount,
        }];
    const scheduled = this.scheduleIfEligible(position);
    if (scheduled !== undefined) events.push(scheduled);
    return events;
  }

  private scheduleIfEligible(position: Position): BattleEvent | undefined {
    const cell = this.state.cellAt(position);
    const key = this.positionKey(position);
    if (
      cell.kind !== "occupied" ||
      cell.count < this.thresholdAt(position) ||
      this.state.pendingSplitAt(position) !== undefined ||
      this.dueSplitPositions.has(key)
    ) return undefined;

    const dueTick = this.state.tick + this.state.config.splitDelayTicks;
    if (!Number.isSafeInteger(dueTick)) {
      throw new RangeError("Split due tick exceeds the safe integer range");
    }
    if (this.nextSplitSequence === null) {
      throw new RangeError("Pending split sequence space is exhausted");
    }
    const split: PendingSplit = {
      position: { ...position },
      dueTick,
      sequence: this.nextSplitSequence,
    };
    this.nextSplitSequence = this.nextSplitSequence === Number.MAX_SAFE_INTEGER
      ? null
      : this.nextSplitSequence + 1;
    this.state.addPendingSplit(split);
    return { kind: "splitScheduled", ...split };
  }

  private thresholdAt(position: Position): number {
    return this.state.orthogonalNeighbours(position)
      .filter((neighbour) => this.state.cellAt(neighbour).kind !== "wall").length;
  }

  private takeDueSplits(): PendingSplit[] {
    const due = this.state.pendingSplits().filter(
      (split) => split.dueTick <= this.state.tick,
    );
    for (const split of due) this.state.removePendingSplit(split.position);
    return due;
  }

  private findNextSplitSequence(): number | null {
    let next = 0;
    for (const split of this.state.pendingSplits()) {
      if (split.sequence === Number.MAX_SAFE_INTEGER) return null;
      next = Math.max(next, split.sequence + 1);
    }
    return next;
  }

  private finishIfWon(): BattleEvent | undefined {
    const owners = this.occupiedPlayerIds();
    if (owners.size !== 1) return undefined;
    const winnerId = owners.values().next().value as PlayerId;
    this.state.replaceStatus({ kind: "finished", winnerId });
    return { kind: "battleWon", winnerId };
  }

  private occupiedPlayerIds(): Set<PlayerId> {
    const owners = new Set<PlayerId>();
    for (const [, cell] of this.state.entries()) {
      if (cell.kind === "occupied") owners.add(cell.playerId);
    }
    return owners;
  }

  private assertStateIsValid(isNewBattle: boolean): void {
    BattleEngine.assertNonNegativeInteger(this.state.tick, "Battle tick");
    const players = this.state.players;
    if (players.length < 2 || new Set(players).size !== players.length) {
      throw new Error("A battle requires at least two unique players");
    }
    if (players.some((playerId) => playerId.length === 0)) {
      throw new Error("Player ids must not be empty");
    }
    for (const [position, cell] of this.state.entries()) {
      if (cell.kind === "occupied") {
        if (!players.includes(cell.playerId)) {
          throw new Error(`Cell owner ${cell.playerId} is not a participant`);
        }
        this.assertCount(cell.count);
      }
      if (cell.kind !== "wall" && this.thresholdAt(position) === 0) {
        throw new Error(
          `Traversable cell (${position.x}, ${position.y}) has no traversable neighbours`,
        );
      }
    }
    const seenSequences = new Set<number>();
    for (const split of this.state.pendingSplits()) {
      if (!this.state.contains(split.position)) {
        throw new Error("Pending split position is outside the grid");
      }
      if (this.state.cellAt(split.position).kind !== "occupied") {
        throw new Error("Pending split source must be occupied");
      }
      if (seenSequences.has(split.sequence)) {
        throw new Error(`Duplicate pending split sequence ${split.sequence}`);
      }
      seenSequences.add(split.sequence);
    }
    for (const playerId of players) {
      const cooldown = this.state.cooldownFor(playerId);
      if (cooldown !== undefined) {
        BattleEngine.assertNonNegativeInteger(cooldown.nextActionTick, "Next action tick");
      }
    }
    const owners = this.occupiedPlayerIds();
    if (isNewBattle && owners.size < 2) {
      throw new Error("A new battle requires occupied cells for two players");
    }
    if (this.state.status.kind === "running" && owners.size < 2) {
      throw new Error("A running battle requires at least two active owners");
    }
    const status = this.state.status;
    if (
      status.kind === "finished" &&
      (owners.size !== 1 || !owners.has(status.winnerId))
    ) {
      throw new Error("Finished battle winner does not match occupied cells");
    }
    if (status.kind === "finished" && this.state.pendingSplits().length > 0) {
      throw new Error("Finished battle cannot contain pending splits");
    }
  }

  private positionKey(position: Position): string {
    return `${position.x},${position.y}`;
  }

  private assertCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError("Occupied cell count must be a positive safe integer");
    }
  }

  private static assertConfig(config: BattleConfig): void {
    if (!Number.isFinite(config.ticksPerSecond) || config.ticksPerSecond <= 0) {
      throw new RangeError("Ticks per second must be a positive finite number");
    }
    BattleEngine.assertNonNegativeInteger(config.splitDelayTicks, "Split delay");
    if (config.splitDelayTicks === 0) {
      throw new RangeError("Split delay must be at least one tick");
    }
  }

  private static assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer`);
    }
  }
}
