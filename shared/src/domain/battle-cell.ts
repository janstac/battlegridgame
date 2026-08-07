import Type from "typebox";

import { PlayerIdSchema } from "./ids.ts";

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

/** Runtime schema for a player-owned cell with a positive count. */
export const OccupiedCellSchema = Type.Object(
  {
    kind: Type.Literal("occupied"),
    playerId: PlayerIdSchema,
    count: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
/** A cell owned by a player and carrying one or more counters. */
export type OccupiedCell = Type.Static<typeof OccupiedCellSchema>;

/** Runtime schema for every supported battle-cell state. */
export const BattleCellSchema = Type.Union([
  EmptyCellSchema,
  WallCellSchema,
  OccupiedCellSchema,
]);
/** Discriminated union of empty, wall, and occupied cells. */
export type BattleCell = Type.Static<typeof BattleCellSchema>;
