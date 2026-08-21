import {
  BattleState,
  type BattleParticipantId,
  type BattleCell,
  type BattleConfig,
  type BattleSetup,
  type BattleSnapshot,
  type BattleStatus,
  type PendingSplit,
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

  /** Withdraws one participant and immediately reevaluates the battle outcome. */
  withdrawParticipant(participantId: BattleParticipantId): BattleEvent[] {
    return this.runAtomically(() => {
      const participant = this.state.participant(participantId);
      if (participant === undefined) {
        throw new Error(`Unknown participant ${participantId}`);
      }
      if (participant.status !== "active" || this.state.status.kind === "finished") {
        return [];
      }

      this.state.replaceParticipant({ participantId, status: "withdrawn" });
      const events: BattleEvent[] = [{
        kind: "participantStatusChanged",
        participantId,
        status: "withdrawn",
      }];
      events.push(...this.adjudicate());
      return events;
    });
  }

  private applyIncrementCommand(
    context: CommandContext,
    command: BattleCommand,
  ): CommandResult {
    if (this.state.status.kind === "finished") {
      return { accepted: false, reason: "battleFinished" };
    }
    const participant = this.state.participant(context.participantId);
    if (participant === undefined) {
      return { accepted: false, reason: "unknownParticipant" };
    }
    if (participant.status !== "active") {
      return { accepted: false, reason: "participantInactive" };
    }
    if (!this.state.contains(command.position)) {
      return { accepted: false, reason: "outOfBounds" };
    }
    const cell = this.state.cellAt(command.position);
    if (cell.kind !== "occupied") {
      return { accepted: false, reason: "notOccupied" };
    }
    if (cell.participantId !== context.participantId) {
      return { accepted: false, reason: "notOwner" };
    }
    if (
      this.state.tick <
      (this.state.cooldownFor(context.participantId)?.nextActionTick ?? 0)
    ) {
      return { accepted: false, reason: "cooldownActive" };
    }

    const previousCooldown = this.state.cooldownFor(context.participantId);
    const acceptedActionCount = (previousCooldown?.acceptedActionCount ?? 0) + 1;
    BattleEngine.assertNonNegativeInteger(acceptedActionCount, "Accepted action count");
    const durationTicks = this.cooldownPolicy.durationTicks({
      participantId: context.participantId,
      acceptedActionCount,
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

    const events = this.applyIncrement(context.participantId, command.position);
    this.state.replaceCooldown({
      participantId: context.participantId,
      nextActionTick,
      durationTicks,
      acceptedActionCount,
    });
    events.push({
      kind: "cooldownStarted",
      participantId: context.participantId,
      nextActionTick,
      durationTicks,
      acceptedActionCount,
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
        events.push(...this.adjudicate());
        if (this.state.status.kind === "finished") {
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

  private applyIncrement(
    participantId: BattleParticipantId,
    position: Position,
  ): BattleEvent[] {
    const cell = this.state.cellAt(position);
    if (cell.kind !== "occupied" || cell.participantId !== participantId) {
      throw new Error("Internal increment precondition failed");
    }
    const nextCount = cell.count + 1;
    this.assertCount(nextCount);
    this.state.replaceCell(position, {
      kind: "occupied",
      participantId,
      count: nextCount,
    });
    const events: BattleEvent[] = [{
      kind: "cellIncremented",
      position: { ...position },
      participantId,
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
      participantId: source.participantId,
      count: source.count,
    }];
    this.state.replaceCell(pending.position, { kind: "empty" });

    for (const position of this.state.orthogonalNeighbours(pending.position)) {
      if (this.state.cellAt(position).kind !== "wall") {
        events.push(...this.incrementFromSplit(position, source.participantId));
      }
    }
    return events;
  }

  private incrementFromSplit(
    position: Position,
    participantId: BattleParticipantId,
  ): BattleEvent[] {
    const previous = this.state.cellAt(position);
    if (previous.kind === "wall") return [];
    const previousCount = previous.kind === "occupied" ? previous.count : 0;
    const nextCount = previousCount + 1;
    this.assertCount(nextCount);
    this.state.replaceCell(position, {
      kind: "occupied",
      participantId,
      count: nextCount,
    });

    const events: BattleEvent[] = previous.kind === "occupied" &&
      previous.participantId === participantId
      ? [{
          kind: "cellIncremented",
          position: { ...position },
          participantId,
          previousCount,
          nextCount,
          source: "split",
        }]
      : [{
          kind: "cellCaptured",
          position: { ...position },
          participantId,
          previousParticipantId: previous.kind === "occupied"
            ? previous.participantId
            : null,
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

  private adjudicate(): BattleEvent[] {
    const events: BattleEvent[] = [];
    const owners = this.occupiedParticipantIds();
    for (const participant of this.state.participants) {
      if (participant.status === "active" && !owners.has(participant.participantId)) {
        this.state.replaceParticipant({
          participantId: participant.participantId,
          status: "eliminated",
        });
        events.push({
          kind: "participantStatusChanged",
          participantId: participant.participantId,
          status: "eliminated",
        });
      }
    }

    const contenders = this.state.participants.filter(
      ({ status }) => status === "active",
    );
    if (contenders.length > 1) return events;

    const winnerId = contenders[0]?.participantId ?? null;
    this.state.replaceStatus({ kind: "finished", winnerId });
    this.state.clearPendingSplits();
    this.dueSplitPositions.clear();
    events.push({ kind: "battleFinished", winnerId });
    return events;
  }

  private occupiedParticipantIds(): Set<BattleParticipantId> {
    const owners = new Set<BattleParticipantId>();
    for (const [, cell] of this.state.entries()) {
      if (cell.kind === "occupied") owners.add(cell.participantId);
    }
    return owners;
  }

  private assertStateIsValid(isNewBattle: boolean): void {
    BattleEngine.assertNonNegativeInteger(this.state.tick, "Battle tick");
    const participants = this.state.participants;
    const participantIds = participants.map(({ participantId }) => participantId);
    if (
      participants.length < 2 ||
      new Set(participantIds).size !== participants.length
    ) {
      throw new Error("A battle requires at least two unique participants");
    }
    for (const participantId of participantIds) {
      BattleEngine.assertNonNegativeInteger(participantId, "Participant id");
    }
    for (const { status } of participants) {
      if (status !== "active" && status !== "withdrawn" && status !== "eliminated") {
        throw new Error(`Unsupported participation status: ${String(status)}`);
      }
    }
    for (const [position, cell] of this.state.entries()) {
      if (cell.kind === "occupied") {
        if (!participantIds.includes(cell.participantId)) {
          throw new Error(
            `Cell owner ${cell.participantId} is not a participant`,
          );
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
    for (const participantId of participantIds) {
      const cooldown = this.state.cooldownFor(participantId);
      if (cooldown !== undefined) {
        BattleEngine.assertNonNegativeInteger(cooldown.nextActionTick, "Next action tick");
        BattleEngine.assertNonNegativeInteger(cooldown.durationTicks, "Cooldown duration");
      }
    }
    const owners = this.occupiedParticipantIds();
    const activeParticipants = participants.filter(({ status }) => status === "active");
    const activeContenders = activeParticipants.filter(({ participantId }) =>
      owners.has(participantId)
    );
    const eliminatedOwners = participants.filter(
      ({ participantId, status }) => status === "eliminated" && owners.has(participantId),
    );
    if (eliminatedOwners.length > 0) {
      throw new Error("Eliminated participants cannot own cells");
    }
    if (
      isNewBattle &&
      (activeParticipants.length !== participants.length ||
        activeContenders.length !== participants.length)
    ) {
      throw new Error("A new battle requires occupied cells for every active participant");
    }
    if (
      this.state.status.kind === "running" &&
      (activeParticipants.length < 2 || activeContenders.length !== activeParticipants.length)
    ) {
      throw new Error("A running battle requires at least two active contenders");
    }
    const status = this.state.status;
    if (status.kind === "finished") {
      if (
        status.winnerId === null
          ? activeParticipants.length !== 0
          : activeParticipants.length !== 1 ||
            activeContenders.length !== 1 ||
            activeContenders[0]?.participantId !== status.winnerId
      ) {
        throw new Error("Finished battle winner does not match active contenders");
      }
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
