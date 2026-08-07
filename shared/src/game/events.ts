import Type from "typebox";

import {
  PlayerIdSchema,
  PositionSchema,
  SAFE_INTEGER_MAX,
  TickSchema,
} from "../domain/index.ts";

/** Runtime schema for a same-owner cell increment. */
export const CellIncrementedEventSchema = Type.Object(
  {
    kind: Type.Literal("cellIncremented"),
    position: PositionSchema,
    playerId: PlayerIdSchema,
    previousCount: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
    nextCount: Type.Integer({ minimum: 1, maximum: SAFE_INTEGER_MAX }),
    source: Type.Union([Type.Literal("command"), Type.Literal("split")]),
  },
  { additionalProperties: false },
);

/** Runtime schema for an empty or enemy cell captured by a split. */
export const CellCapturedEventSchema = Type.Object(
  {
    kind: Type.Literal("cellCaptured"),
    position: PositionSchema,
    playerId: PlayerIdSchema,
    previousPlayerId: Type.Union([PlayerIdSchema, Type.Null()]),
    previousCount: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
    nextCount: Type.Integer({ minimum: 1, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);

/** Runtime schema for scheduling a delayed cell split. */
export const SplitScheduledEventSchema = Type.Object(
  {
    kind: Type.Literal("splitScheduled"),
    position: PositionSchema,
    dueTick: TickSchema,
    sequence: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);

/** Runtime schema for a resolved split and its source count. */
export const CellSplitEventSchema = Type.Object(
  {
    kind: Type.Literal("cellSplit"),
    position: PositionSchema,
    playerId: PlayerIdSchema,
    count: Type.Integer({ minimum: 1, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);

/** Runtime schema for starting an accepted command's cooldown. */
export const CooldownStartedEventSchema = Type.Object(
  {
    kind: Type.Literal("cooldownStarted"),
    playerId: PlayerIdSchema,
    nextActionTick: TickSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for the terminal winner event. */
export const BattleWonEventSchema = Type.Object(
  {
    kind: Type.Literal("battleWon"),
    winnerId: PlayerIdSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for every observable deterministic engine event. */
export const BattleEventSchema = Type.Union([
  CellIncrementedEventSchema,
  CellCapturedEventSchema,
  SplitScheduledEventSchema,
  CellSplitEventSchema,
  CooldownStartedEventSchema,
  BattleWonEventSchema,
]);
/** Event emitted by an accepted command or simulation tick. */
export type BattleEvent = Type.Static<typeof BattleEventSchema>;

/** Runtime schema for stable command-rejection reason codes. */
export const CommandRejectionReasonSchema = Type.Union([
  Type.Literal("battleFinished"),
  Type.Literal("unknownPlayer"),
  Type.Literal("outOfBounds"),
  Type.Literal("notOccupied"),
  Type.Literal("notOwner"),
  Type.Literal("cooldownActive"),
]);
/** Stable reason code returned for a rejected command. */
export type CommandRejectionReason = Type.Static<
  typeof CommandRejectionReasonSchema
>;

/** Accepted events or a stable rejection returned by command application. */
export type CommandResult =
  | { accepted: true; events: BattleEvent[] }
  | { accepted: false; reason: CommandRejectionReason };

/** Events emitted while advancing one simulation tick. */
export type TickResult = {
  tick: number;
  events: BattleEvent[];
};
