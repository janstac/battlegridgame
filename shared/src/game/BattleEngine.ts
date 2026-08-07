import type {
  BattleCell,
  BattleId,
  BattleSetup,
  BattleSnapshot,
  BattleStatus,
  PendingSplit,
  PlayerId,
  Position,
} from "../domain/index.ts";
import { FixedGrid } from "../grid/index.ts";
import type { BattleConfig } from "./BattleConfig.ts";
import type { BattleCommand, CommandContext } from "./commands.ts";
import type { CooldownPolicy } from "./CooldownPolicy.ts";
import { CooldownTracker } from "./CooldownTracker.ts";
import type {
  BattleEvent,
  CommandResult,
  TickResult,
} from "./events.ts";
import { SplitScheduler } from "./SplitScheduler.ts";

/** Authoritative deterministic simulation for a single isolated battle. */
export class BattleEngine {
  private readonly id: BattleId;
  private readonly playerIds: PlayerId[];
  private readonly playerIdSet: Set<PlayerId>;
  private readonly grid: FixedGrid<BattleCell>;
  private readonly config: BattleConfig;
  private readonly cooldownPolicy: CooldownPolicy;
  private readonly cooldowns: CooldownTracker;
  private readonly splits: SplitScheduler;
  private readonly dueSplitIndices = new Set<number>();
  private tick: number;
  private revision: number;
  private battleStatus: BattleStatus;

  private constructor(
    snapshot: BattleSnapshot,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ) {
    this.id = snapshot.battleId;
    this.playerIds = [...snapshot.players];
    this.playerIdSet = new Set(snapshot.players);
    this.grid = FixedGrid.fromData({
      ...snapshot.grid,
      cells: snapshot.grid.cells.map((cell) => this.copyCell(cell)),
    });
    this.config = { ...config };
    this.cooldownPolicy = cooldownPolicy;
    this.cooldowns = new CooldownTracker(snapshot.cooldowns);
    this.splits = new SplitScheduler(snapshot.pendingSplits);
    this.tick = snapshot.tick;
    this.revision = snapshot.revision;
    this.battleStatus = this.copyStatus(snapshot.status);
  }

  /** Creates an engine after validating a new battle setup. */
  static create(
    setup: BattleSetup,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    BattleEngine.assertConfig(config);
    const snapshot: BattleSnapshot = {
      battleId: setup.battleId,
      tick: 0,
      revision: 0,
      status: { kind: "running" },
      players: [...setup.players],
      grid: {
        ...setup.grid,
        cells: setup.grid.cells.map((cell) => BattleEngine.copyCellValue(cell)),
      },
      cooldowns: [],
      pendingSplits: [],
    };
    const engine = new BattleEngine(snapshot, config, cooldownPolicy);
    engine.assertStateIsValid(true);

    // Counts at or above threshold in a supplied setup must not become inert.
    for (const [position] of engine.grid.entries()) {
      engine.scheduleIfEligible(position);
    }
    return engine;
  }

  /** Restores an engine from a complete authoritative snapshot. */
  static restore(
    snapshot: BattleSnapshot,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    BattleEngine.assertConfig(config);
    const engine = new BattleEngine(snapshot, config, cooldownPolicy);
    engine.assertStateIsValid(false);
    return engine;
  }

  /** Identifier of the simulated battle. */
  get battleId(): BattleId {
    return this.id;
  }

  /** Current logical simulation tick. */
  get currentTick(): number {
    return this.tick;
  }

  /** Current running or finished lifecycle state. */
  get status(): BattleStatus {
    return this.copyStatus(this.battleStatus);
  }

  /** Returns an independent plain-data snapshot of authoritative state. */
  getSnapshot(): BattleSnapshot {
    return {
      battleId: this.id,
      tick: this.tick,
      revision: this.revision,
      status: this.copyStatus(this.battleStatus),
      players: [...this.playerIds],
      grid: this.grid.toData((cell) => this.copyCell(cell)),
      cooldowns: this.cooldowns.toData(),
      pendingSplits: this.splits.toData(),
    };
  }

  /** Validates and applies one command without advancing simulation time. */
  applyCommand(
    context: CommandContext,
    command: BattleCommand,
  ): CommandResult {
    if (this.battleStatus.kind === "finished") {
      return { accepted: false, reason: "battleFinished" };
    }
    if (!this.playerIdSet.has(context.playerId)) {
      return { accepted: false, reason: "unknownPlayer" };
    }
    if (!this.grid.contains(command.position)) {
      return { accepted: false, reason: "outOfBounds" };
    }

    const cell = this.grid.get(command.position);
    if (cell.kind !== "occupied") {
      return { accepted: false, reason: "notOccupied" };
    }
    if (cell.playerId !== context.playerId) {
      return { accepted: false, reason: "notOwner" };
    }
    if (!this.cooldowns.canAct(context.playerId, this.tick)) {
      return { accepted: false, reason: "cooldownActive" };
    }

    // Ask the policy before mutation so a bad policy cannot partially apply a command.
    const durationTicks = this.cooldownPolicy.durationTicks({
      playerId: context.playerId,
      currentTick: this.tick,
      position: { ...command.position },
      snapshot: this.getSnapshot(),
    });
    BattleEngine.assertNonNegativeInteger(durationTicks, "Cooldown duration");
    BattleEngine.assertNonNegativeInteger(
      this.tick + durationTicks,
      "Cooldown next action tick",
    );

    const events = this.applyIncrement(context.playerId, command.position);
    const cooldown = this.cooldowns.start(
      context.playerId,
      this.tick,
      durationTicks,
    );
    events.push({
      kind: "cooldownStarted",
      playerId: context.playerId,
      nextActionTick: cooldown.nextActionTick,
    });
    this.revision += 1;
    return { accepted: true, events };
  }

  /** Advances one tick and resolves all splits due in stable queue order. */
  advanceTick(): TickResult {
    if (this.battleStatus.kind === "finished") {
      return { tick: this.tick, events: [] };
    }
    if (this.tick === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Battle tick exceeds the safe integer range");
    }

    this.tick += 1;
    const events: BattleEvent[] = [];
    const dueSplits = this.splits.takeDue(this.tick);
    for (const pending of dueSplits) {
      this.dueSplitIndices.add(this.grid.indexOf(pending.position));
    }

    // takeDue fixes this tick's work list, so newly scheduled chain reactions wait.
    for (const pending of dueSplits) {
      // Once this entry starts, later splits may legitimately repopulate it.
      this.dueSplitIndices.delete(this.grid.indexOf(pending.position));
      events.push(...this.resolveSplit(pending));
      const won = this.finishIfWon();
      if (won !== undefined) {
        events.push(won);
        // A terminal battle must never retain future or same-tick work.
        this.splits.clear();
        this.dueSplitIndices.clear();
        break;
      }
    }
    this.dueSplitIndices.clear();

    // The logical tick is snapshot state, even on ticks without gameplay events.
    this.revision += 1;
    return { tick: this.tick, events };
  }

  private applyIncrement(playerId: PlayerId, position: Position): BattleEvent[] {
    const cell = this.grid.get(position);
    if (cell.kind !== "occupied" || cell.playerId !== playerId) {
      throw new Error("Internal increment precondition failed");
    }
    const nextCount = cell.count + 1;
    this.assertCount(nextCount);
    this.grid.set(position, { kind: "occupied", playerId, count: nextCount });
    const events: BattleEvent[] = [
      {
        kind: "cellIncremented",
        position: { ...position },
        playerId,
        previousCount: cell.count,
        nextCount,
        source: "command",
      },
    ];
    const scheduled = this.scheduleIfEligible(position);
    if (scheduled !== undefined) {
      events.push(scheduled);
    }
    return events;
  }

  private resolveSplit(pending: PendingSplit): BattleEvent[] {
    const source = this.grid.get(pending.position);
    if (source.kind !== "occupied") {
      // An emptied source invalidates its queued action without side effects.
      return [];
    }

    const events: BattleEvent[] = [
      {
        kind: "cellSplit",
        position: { ...pending.position },
        playerId: source.playerId,
        count: source.count,
      },
    ];
    this.grid.set(pending.position, { kind: "empty" });

    for (const position of this.grid.orthogonalNeighbours(pending.position)) {
      const cell = this.grid.get(position);
      if (cell.kind === "wall") {
        continue;
      }
      events.push(...this.incrementFromSplit(position, source.playerId));
    }
    return events;
  }

  private incrementFromSplit(
    position: Position,
    playerId: PlayerId,
  ): BattleEvent[] {
    const previous = this.grid.get(position);
    if (previous.kind === "wall") {
      return [];
    }

    const previousCount = previous.kind === "occupied" ? previous.count : 0;
    const nextCount = previousCount + 1;
    this.assertCount(nextCount);
    this.grid.set(position, { kind: "occupied", playerId, count: nextCount });

    const events: BattleEvent[] = [];
    if (previous.kind === "occupied" && previous.playerId === playerId) {
      events.push({
        kind: "cellIncremented",
        position: { ...position },
        playerId,
        previousCount,
        nextCount,
        source: "split",
      });
    } else {
      events.push({
        kind: "cellCaptured",
        position: { ...position },
        playerId,
        previousPlayerId:
          previous.kind === "occupied" ? previous.playerId : null,
        previousCount,
        nextCount,
      });
    }

    // Capturing a queued cell deliberately preserves its coordinate-based split.
    const scheduled = this.scheduleIfEligible(position);
    if (scheduled !== undefined) {
      events.push(scheduled);
    }
    return events;
  }

  private scheduleIfEligible(position: Position): BattleEvent | undefined {
    const cell = this.grid.get(position);
    if (
      cell.kind !== "occupied" ||
      cell.count < this.thresholdAt(position) ||
      this.splits.has(position) ||
      this.dueSplitIndices.has(this.grid.indexOf(position))
    ) {
      return undefined;
    }
    const dueTick = this.tick + this.config.splitDelayTicks;
    if (!Number.isSafeInteger(dueTick)) {
      throw new RangeError("Split due tick exceeds the safe integer range");
    }
    const split = this.splits.schedule(position, dueTick);
    return {
      kind: "splitScheduled",
      position: { ...position },
      dueTick: split.dueTick,
      sequence: split.sequence,
    };
  }

  private thresholdAt(position: Position): number {
    return this.grid
      .orthogonalNeighbours(position)
      .filter((neighbour) => this.grid.get(neighbour).kind !== "wall").length;
  }

  private finishIfWon(): BattleEvent | undefined {
    const owners = this.occupiedPlayerIds();
    if (owners.size !== 1) {
      return undefined;
    }
    const winnerId = owners.values().next().value as PlayerId;
    this.battleStatus = { kind: "finished", winnerId };
    return { kind: "battleWon", winnerId };
  }

  private occupiedPlayerIds(): Set<PlayerId> {
    const owners = new Set<PlayerId>();
    for (const cell of this.grid.values()) {
      if (cell.kind === "occupied") {
        owners.add(cell.playerId);
      }
    }
    return owners;
  }

  private assertStateIsValid(isNewBattle: boolean): void {
    BattleEngine.assertNonNegativeInteger(this.tick, "Battle tick");
    BattleEngine.assertNonNegativeInteger(this.revision, "Battle revision");
    if (this.id.length === 0) {
      throw new Error("Battle id must not be empty");
    }
    if (
      this.playerIds.length < 2 ||
      this.playerIdSet.size !== this.playerIds.length
    ) {
      throw new Error("A battle requires at least two unique players");
    }
    if (this.playerIds.some((playerId) => playerId.length === 0)) {
      throw new Error("Player ids must not be empty");
    }

    for (const [position, cell] of this.grid.entries()) {
      if (cell.kind === "occupied") {
        if (!this.playerIdSet.has(cell.playerId)) {
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

    for (const cooldown of this.cooldowns.toData()) {
      if (!this.playerIdSet.has(cooldown.playerId)) {
        throw new Error(`Cooldown player ${cooldown.playerId} is not a participant`);
      }
    }
    for (const split of this.splits.toData()) {
      if (!this.grid.contains(split.position)) {
        throw new Error("Pending split position is outside the grid");
      }
      if (this.grid.get(split.position).kind !== "occupied") {
        throw new Error("Pending split source must be occupied");
      }
    }

    const owners = this.occupiedPlayerIds();
    if (isNewBattle && owners.size < 2) {
      throw new Error("A new battle requires occupied cells for two players");
    }
    if (this.battleStatus.kind === "running" && owners.size < 2) {
      throw new Error("A running battle requires at least two active owners");
    }
    if (
      this.battleStatus.kind === "finished" &&
      (owners.size !== 1 || !owners.has(this.battleStatus.winnerId))
    ) {
      throw new Error("Finished battle winner does not match occupied cells");
    }
    if (
      this.battleStatus.kind === "finished" &&
      this.splits.toData().length > 0
    ) {
      throw new Error("Finished battle cannot contain pending splits");
    }
  }

  private assertCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError("Occupied cell count must be a positive safe integer");
    }
  }

  private copyCell(cell: BattleCell): BattleCell {
    return BattleEngine.copyCellValue(cell);
  }

  private copyStatus(status: BattleStatus): BattleStatus {
    return status.kind === "running"
      ? { kind: "running" }
      : { kind: "finished", winnerId: status.winnerId };
  }

  private static copyCellValue(cell: BattleCell): BattleCell {
    return cell.kind === "occupied" ? { ...cell } : { kind: cell.kind };
  }

  private static assertConfig(config: BattleConfig): void {
    BattleEngine.assertNonNegativeInteger(
      config.splitDelayTicks,
      "Split delay",
    );
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
