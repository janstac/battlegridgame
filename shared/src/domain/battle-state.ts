import Type from "typebox";
import { BattleCellSchema } from "./battle-cell.ts";
import { BattleConfigSchema, type BattleConfig } from "./battle-config.ts";
import {
  PositionSchema,
  SAFE_INTEGER_MAX,
  TickSchema,
} from "./coordinate.ts";
import { SerializedGridSchema } from "./grid.ts";
import { PlayerIdSchema, type PlayerId } from "./ids.ts";
import type { BattleCell } from "./battle-cell.ts";
import type { Position } from "./coordinate.ts";
import type { SerializedGrid } from "./grid.ts";
import { FixedGrid } from "../grid/FixedGrid.ts";

/** Runtime schema for an active battle. */
export const RunningBattleStatusSchema = Type.Object(
  { kind: Type.Literal("running") },
  { additionalProperties: false },
);

/** Runtime schema for a completed battle and its winner. */
export const FinishedBattleStatusSchema = Type.Object(
  {
    kind: Type.Literal("finished"),
    winnerId: PlayerIdSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for the battle lifecycle state. */
export const BattleStatusSchema = Type.Union([
  RunningBattleStatusSchema,
  FinishedBattleStatusSchema,
]);
/** Indicates whether a battle is active or has a winner. */
export type BattleStatus = Type.Static<typeof BattleStatusSchema>;

/** Runtime schema for one player's next permitted action tick. */
export const PlayerCooldownSchema = Type.Object(
  {
    playerId: PlayerIdSchema,
    nextActionTick: TickSchema,
  },
  { additionalProperties: false },
);
/** Serializable per-player cooldown state for one battle. */
export type PlayerCooldown = Type.Static<typeof PlayerCooldownSchema>;

/** Runtime schema for a delayed split in deterministic queue order. */
export const PendingSplitSchema = Type.Object(
  {
    position: PositionSchema,
    dueTick: TickSchema,
    sequence: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);
/** Serializable delayed split scheduled at a grid position. */
export type PendingSplit = Type.Static<typeof PendingSplitSchema>;

/** Runtime schema for immutable inputs used to create a battle. */
export const BattleSetupSchema = Type.Object(
  {
    players: Type.Array(PlayerIdSchema, { minItems: 2, uniqueItems: true }),
    grid: SerializedGridSchema(BattleCellSchema),
  },
  { additionalProperties: false },
);
/** Initial participants and grid supplied to a new engine. */
export type BattleSetup = Type.Static<typeof BattleSetupSchema>;

/** Runtime schema for a complete authoritative battle snapshot. */
export const BattleSnapshotSchema = Type.Object(
  {
    config: BattleConfigSchema,
    tick: TickSchema,
    status: BattleStatusSchema,
    players: Type.Array(PlayerIdSchema, { minItems: 2, uniqueItems: true }),
    grid: SerializedGridSchema(BattleCellSchema),
    cooldowns: Type.Array(PlayerCooldownSchema),
    pendingSplits: Type.Array(PendingSplitSchema),
  },
  { additionalProperties: false },
);
/** Complete plain-data state sufficient to render or restore a battle. */
export type BattleSnapshot = Type.Static<typeof BattleSnapshotSchema>;

function copyCell(cell: BattleCell): BattleCell {
  const kind = (cell as { kind?: unknown } | null)?.kind;
  switch (kind) {
    case "empty":
      return { kind: "empty" };
    case "wall":
      return { kind: "wall" };
    case "occupied":
      return { ...cell };
    default:
      throw new TypeError(`Unsupported battle cell kind: ${String(kind)}`);
  }
}

function copyStatus(status: BattleStatus): BattleStatus {
  return status.kind === "running"
    ? { kind: "running" }
    : { kind: "finished", winnerId: status.winnerId };
}

function copySplit(split: PendingSplit): PendingSplit {
  return { ...split, position: { ...split.position } };
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/**
 * Reusable mutable storage for battle facts.
 *
 * This class deliberately makes no rule decisions. The engine and protocol
 * projector calculate outcomes, then use these mechanical mutation methods to
 * store their authoritative values.
 */
export class BattleState {
  private readonly battleConfig: BattleConfig;
  private readonly playerIds: PlayerId[];
  private grid: FixedGrid<BattleCell>;
  private currentTick: number;
  private battleStatus: BattleStatus;
  private cooldownsByPlayer: Map<PlayerId, PlayerCooldown>;
  private splitsByPosition: Map<string, PendingSplit>;

  private constructor(snapshot: BattleSnapshot) {
    this.battleConfig = { ...snapshot.config };
    this.playerIds = [...snapshot.players];
    this.grid = FixedGrid.fromData({
      ...snapshot.grid,
      cells: snapshot.grid.cells.map(copyCell),
    });
    this.currentTick = snapshot.tick;
    this.battleStatus = copyStatus(snapshot.status);
    this.cooldownsByPlayer = new Map();
    for (const cooldown of snapshot.cooldowns) {
      if (!this.playerIds.includes(cooldown.playerId)) {
        throw new Error(`Cooldown player ${cooldown.playerId} is not a participant`);
      }
      if (this.cooldownsByPlayer.has(cooldown.playerId)) {
        throw new Error(`Duplicate cooldown for player ${cooldown.playerId}`);
      }
      this.cooldownsByPlayer.set(cooldown.playerId, { ...cooldown });
    }
    this.splitsByPosition = new Map();
    for (const split of snapshot.pendingSplits) {
      const key = positionKey(split.position);
      if (this.splitsByPosition.has(key)) {
        throw new Error(`Duplicate pending split at ${key}`);
      }
      this.splitsByPosition.set(key, copySplit(split));
    }
  }

  /** Creates initial storage from battle inputs and immutable configuration. */
  static create(setup: BattleSetup, config: BattleConfig): BattleState {
    return new BattleState({
      config: { ...config },
      tick: 0,
      status: { kind: "running" },
      players: [...setup.players],
      grid: { ...setup.grid, cells: setup.grid.cells.map(copyCell) },
      cooldowns: [],
      pendingSplits: [],
    });
  }

  /** Restores storage from a complete plain-data snapshot. */
  static restore(snapshot: BattleSnapshot): BattleState {
    return new BattleState(snapshot);
  }

  get config(): Readonly<BattleConfig> {
    return { ...this.battleConfig };
  }

  get tick(): number {
    return this.currentTick;
  }

  get status(): BattleStatus {
    return copyStatus(this.battleStatus);
  }

  get players(): readonly PlayerId[] {
    return [...this.playerIds];
  }

  cellAt(position: Position): BattleCell {
    return copyCell(this.grid.get(position));
  }

  contains(position: Position): boolean {
    return this.grid.contains(position);
  }

  orthogonalNeighbours(position: Position): Position[] {
    return this.grid.orthogonalNeighbours(position);
  }

  entries(): Array<readonly [Position, BattleCell]> {
    return [...this.grid.entries()].map(([position, cell]) => [
      { ...position },
      copyCell(cell),
    ] as const);
  }

  cooldownFor(playerId: PlayerId): PlayerCooldown | undefined {
    const cooldown = this.cooldownsByPlayer.get(playerId);
    return cooldown === undefined ? undefined : { ...cooldown };
  }

  pendingSplitAt(position: Position): PendingSplit | undefined {
    const split = this.splitsByPosition.get(positionKey(position));
    return split === undefined ? undefined : copySplit(split);
  }

  pendingSplits(): PendingSplit[] {
    return [...this.splitsByPosition.values()]
      .sort((left, right) => left.dueTick - right.dueTick || left.sequence - right.sequence)
      .map(copySplit);
  }

  setTick(tick: number): void {
    this.currentTick = tick;
  }

  replaceStatus(status: BattleStatus): void {
    this.battleStatus = copyStatus(status);
  }

  replaceCell(position: Position, cell: BattleCell): void {
    this.grid.set(position, copyCell(cell));
  }

  replaceCooldown(cooldown: PlayerCooldown): void {
    this.cooldownsByPlayer.set(cooldown.playerId, { ...cooldown });
  }

  addPendingSplit(split: PendingSplit): void {
    this.splitsByPosition.set(positionKey(split.position), copySplit(split));
  }

  removePendingSplit(position: Position): void {
    this.splitsByPosition.delete(positionKey(position));
  }

  clearPendingSplits(): void {
    this.splitsByPosition.clear();
  }

  clone(): BattleState {
    return BattleState.restore(this.toSnapshot());
  }

  toSnapshot(): BattleSnapshot {
    const cooldowns: PlayerCooldown[] = [];
    for (const playerId of this.playerIds) {
      const cooldown = this.cooldownsByPlayer.get(playerId);
      if (cooldown !== undefined) {
        cooldowns.push({ ...cooldown });
      }
    }
    return {
      config: { ...this.battleConfig },
      tick: this.currentTick,
      status: copyStatus(this.battleStatus),
      players: [...this.playerIds],
      grid: this.grid.toData(copyCell),
      cooldowns,
      pendingSplits: this.pendingSplits(),
    };
  }
}
