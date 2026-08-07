import Type from "typebox";
import Schema from "typebox/schema";

import { BattleCellSchema } from "./battle-cell.ts";
import {
  PositionSchema,
  SAFE_INTEGER_MAX,
  TickSchema,
} from "./coordinate.ts";
import { SerializedGridSchema } from "./grid.ts";
import { BattleIdSchema, PlayerIdSchema } from "./ids.ts";

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
    battleId: BattleIdSchema,
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
    battleId: BattleIdSchema,
    tick: TickSchema,
    revision: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
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

/** One actionable structural or semantic problem in battle state. */
export type BattleStateValidationIssue = Readonly<{
  path: string;
  message: string;
}>;

/** Error thrown when untrusted setup or snapshot data violates battle invariants. */
export class BattleStateValidationError extends TypeError {
  /** All validation problems found before validation stopped. */
  readonly issues: readonly BattleStateValidationIssue[];

  /** Creates a validation error with stable JSON-pointer-like issue paths. */
  constructor(label: string, issues: readonly BattleStateValidationIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    super(`${label} is invalid${summary.length === 0 ? "" : `: ${summary}`}`);
    this.name = "BattleStateValidationError";
    this.issues = [...issues];
  }
}

const BattleSetupValidator = Schema.Compile(BattleSetupSchema);
const BattleSnapshotValidator = Schema.Compile(BattleSnapshotSchema);

/** Runtime-validates a battle setup, including cross-field game invariants. */
export function assertValidBattleSetup(
  value: unknown,
): asserts value is BattleSetup {
  const structuralIssues = getStructuralIssues(BattleSetupValidator, value);
  if (structuralIssues.length > 0) {
    throw new BattleStateValidationError("Battle setup", structuralIssues);
  }

  const issues = getCommonStateIssues(value as BattleSetup);
  const owners = occupiedOwners(value as BattleSetup);
  if (owners.size < 2) {
    issues.push({
      path: "/grid/cells",
      message: "a new battle requires occupied cells for at least two players",
    });
  }
  if (issues.length > 0) {
    throw new BattleStateValidationError("Battle setup", issues);
  }
}

/** Runtime-validates a restorable snapshot and all lifecycle invariants. */
export function assertValidBattleSnapshot(
  value: unknown,
): asserts value is BattleSnapshot {
  const structuralIssues = getStructuralIssues(BattleSnapshotValidator, value);
  if (structuralIssues.length > 0) {
    throw new BattleStateValidationError("Battle snapshot", structuralIssues);
  }

  const snapshot = value as BattleSnapshot;
  const issues = getCommonStateIssues(snapshot);
  const participants = new Set(snapshot.players);
  const owners = occupiedOwners(snapshot);

  const cooldownPlayers = new Set<string>();
  snapshot.cooldowns.forEach((cooldown, index) => {
    if (cooldownPlayers.has(cooldown.playerId)) {
      issues.push({
        path: `/cooldowns/${index}/playerId`,
        message: `duplicate cooldown for player ${cooldown.playerId}`,
      });
    }
    cooldownPlayers.add(cooldown.playerId);
    if (!participants.has(cooldown.playerId)) {
      issues.push({
        path: `/cooldowns/${index}/playerId`,
        message: `cooldown owner ${cooldown.playerId} is not a participant`,
      });
    }
  });

  const pendingPositions = new Set<string>();
  const pendingSequences = new Set<number>();
  snapshot.pendingSplits.forEach((split, index) => {
    const positionKey = `${split.position.x},${split.position.y}`;
    if (pendingPositions.has(positionKey)) {
      issues.push({
        path: `/pendingSplits/${index}/position`,
        message: `duplicate pending position ${positionKey}`,
      });
    }
    pendingPositions.add(positionKey);
    if (pendingSequences.has(split.sequence)) {
      issues.push({
        path: `/pendingSplits/${index}/sequence`,
        message: `duplicate pending sequence ${split.sequence}`,
      });
    }
    pendingSequences.add(split.sequence);

    if (!positionIsInGrid(split.position, snapshot.grid)) {
      issues.push({
        path: `/pendingSplits/${index}/position`,
        message: "pending split position is outside the grid",
      });
      return;
    }
    const cell = snapshot.grid.cells[
      split.position.y * snapshot.grid.width + split.position.x
    ];
    if (cell?.kind !== "occupied") {
      issues.push({
        path: `/pendingSplits/${index}/position`,
        message: "pending split source must be occupied",
      });
    }
  });

  // A lifecycle status must agree with the authoritative ownership state.
  if (snapshot.status.kind === "running" && owners.size < 2) {
    issues.push({
      path: "/status",
      message: "a running battle requires at least two active owners",
    });
  } else if (snapshot.status.kind === "finished") {
    if (!participants.has(snapshot.status.winnerId)) {
      issues.push({
        path: "/status/winnerId",
        message: "winner is not a participant",
      });
    }
    if (owners.size !== 1 || !owners.has(snapshot.status.winnerId)) {
      issues.push({
        path: "/status/winnerId",
        message: "winner does not match the sole occupied-cell owner",
      });
    }
    if (snapshot.pendingSplits.length > 0) {
      issues.push({
        path: "/pendingSplits",
        message: "a finished battle cannot contain pending splits",
      });
    }
  }

  if (issues.length > 0) {
    throw new BattleStateValidationError("Battle snapshot", issues);
  }
}

/** Returns whether a value is a structurally and semantically valid setup. */
export function isValidBattleSetup(value: unknown): value is BattleSetup {
  try {
    assertValidBattleSetup(value);
    return true;
  } catch {
    return false;
  }
}

/** Returns whether a value is a structurally and semantically valid snapshot. */
export function isValidBattleSnapshot(value: unknown): value is BattleSnapshot {
  try {
    assertValidBattleSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

type StructuralValidator = {
  Errors(value: unknown): [boolean, Array<{
    instancePath: string;
    message: string;
  }>];
};

function getStructuralIssues(
  validator: StructuralValidator,
  value: unknown,
): BattleStateValidationIssue[] {
  const [valid, errors] = validator.Errors(value);
  return valid
    ? []
    : errors.map((error) => ({
        path: error.instancePath.length === 0 ? "/" : error.instancePath,
        message: error.message,
      }));
}

function getCommonStateIssues(
  state: BattleSetup | BattleSnapshot,
): BattleStateValidationIssue[] {
  const issues: BattleStateValidationIssue[] = [];
  const participants = new Set<string>();
  state.players.forEach((playerId, index) => {
    if (participants.has(playerId)) {
      issues.push({
        path: `/players/${index}`,
        message: `duplicate participant ${playerId}`,
      });
    }
    participants.add(playerId);
  });

  const expectedCellCount = state.grid.width * state.grid.height;
  if (!Number.isSafeInteger(expectedCellCount)) {
    issues.push({
      path: "/grid",
      message: "width multiplied by height exceeds the safe integer range",
    });
  } else if (state.grid.cells.length !== expectedCellCount) {
    issues.push({
      path: "/grid/cells",
      message: `contains ${state.grid.cells.length} cells; expected ${expectedCellCount}`,
    });
  }

  state.grid.cells.forEach((cell, index) => {
    if (cell.kind === "occupied" && !participants.has(cell.playerId)) {
      issues.push({
        path: `/grid/cells/${index}/playerId`,
        message: `cell owner ${cell.playerId} is not a participant`,
      });
    }
    if (
      cell.kind !== "wall" &&
      expectedCellCount === state.grid.cells.length &&
      traversableNeighbourCount(index, state.grid) === 0
    ) {
      issues.push({
        path: `/grid/cells/${index}`,
        message: "traversable cell has no traversable neighbours",
      });
    }
  });
  return issues;
}

function occupiedOwners(state: BattleSetup | BattleSnapshot): Set<string> {
  const owners = new Set<string>();
  for (const cell of state.grid.cells) {
    if (cell.kind === "occupied") {
      owners.add(cell.playerId);
    }
  }
  return owners;
}

function positionIsInGrid(
  position: { x: number; y: number },
  grid: { width: number; height: number },
): boolean {
  return (
    position.x >= 0 &&
    position.x < grid.width &&
    position.y >= 0 &&
    position.y < grid.height
  );
}

function traversableNeighbourCount(
  index: number,
  grid: BattleSetup["grid"],
): number {
  const x = index % grid.width;
  const y = Math.floor(index / grid.width);
  const candidates = [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ];
  return candidates.filter((position) => {
    if (!positionIsInGrid(position, grid)) {
      return false;
    }
    return grid.cells[position.y * grid.width + position.x]?.kind !== "wall";
  }).length;
}
