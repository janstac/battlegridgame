import Type from "typebox";

import { BattleCellSchema } from "./battle-cell.ts";
import { PositionSchema, TickSchema } from "./coordinate.ts";
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
    sequence: Type.Integer({ minimum: 0 }),
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
    revision: Type.Integer({ minimum: 0 }),
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
