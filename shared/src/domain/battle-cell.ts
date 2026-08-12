import Type from "typebox";

import { SAFE_INTEGER_MAX } from "./coordinate.ts";
import { BattleParticipantIdSchema } from "./ids.ts";

/** Runtime schema for a traversable, unoccupied battle cell. */
export const EmptyCellSchema = Type.Object(
  { kind: Type.Literal("empty") },
  { additionalProperties: false },
);
/** A traversable cell with no owner or count. */
export type EmptyCell = Type.Static<typeof EmptyCellSchema>;

/** Runtime schema for an immutable blocking cell. */
export const WallCellSchema = Type.Object(
  { kind: Type.Literal("wall") },
  { additionalProperties: false },
);
/** A blocking cell excluded from split thresholds and propagation. */
export type WallCell = Type.Static<typeof WallCellSchema>;

/** Runtime schema for a participant-owned cell with a positive count. */
export const OccupiedCellSchema = Type.Object(
  {
    kind: Type.Literal("occupied"),
    participantId: BattleParticipantIdSchema,
    count: Type.Integer({ minimum: 1, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);
/** A cell owned by a battle participant and carrying one or more counters. */
export type OccupiedCell = Type.Static<typeof OccupiedCellSchema>;

/** Runtime schema for every supported battle-cell state. */
export const BattleCellSchema = Type.Union([
  EmptyCellSchema,
  WallCellSchema,
  OccupiedCellSchema,
]);
/** Discriminated union of empty, wall, and occupied cells. */
export type BattleCell = Type.Static<typeof BattleCellSchema>;
