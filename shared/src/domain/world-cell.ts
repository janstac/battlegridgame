import Type from "typebox";

import {
  BattleIdSchema,
  ChallengeIdSchema,
  PlayerIdSchema,
  UnixTimestampMsSchema,
} from "./ids.ts";

/** A World position that is available for initial allocation. */
export const UnoccupiedWorldCellSchema = Type.Object(
  { kind: Type.Literal("unoccupied") },
  { additionalProperties: false },
);
export type UnoccupiedWorldCell = Type.Static<
  typeof UnoccupiedWorldCellSchema
>;

/** A World position controlled by one connected player. */
export const OccupiedWorldCellSchema = Type.Object(
  {
    kind: Type.Literal("occupied"),
    playerId: PlayerIdSchema,
  },
  { additionalProperties: false },
);
export type OccupiedWorldCell = Type.Static<typeof OccupiedWorldCellSchema>;

/** Public facts for a challenge while its participant roster remains open. */
export const ChallengePendingWorldCellSchema = Type.Object(
  {
    kind: Type.Literal("challengePending"),
    challengeId: ChallengeIdSchema,
    defenderId: PlayerIdSchema,
    participantIds: Type.Array(PlayerIdSchema, {
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
    }),
    closesAt: UnixTimestampMsSchema,
  },
  { additionalProperties: false },
);
export type ChallengePendingWorldCell = Type.Static<
  typeof ChallengePendingWorldCellSchema
>;

/** Public World metadata for a battle currently occupying the position. */
export const BattleWorldCellSchema = Type.Object(
  {
    kind: Type.Literal("battle"),
    battleId: BattleIdSchema,
    playerIds: Type.Array(PlayerIdSchema, {
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type BattleWorldCell = Type.Static<typeof BattleWorldCellSchema>;

/** Every serializable state of one World position. */
export const WorldCellSchema = Type.Union([
  UnoccupiedWorldCellSchema,
  OccupiedWorldCellSchema,
  ChallengePendingWorldCellSchema,
  BattleWorldCellSchema,
]);
export type WorldCell = Type.Static<typeof WorldCellSchema>;

/** Copies a World cell without retaining mutable participant arrays. */
export function copyWorldCell(cell: WorldCell): WorldCell {
  switch (cell.kind) {
    case "unoccupied":
      return { kind: "unoccupied" };
    case "occupied":
      return { kind: "occupied", playerId: cell.playerId };
    case "challengePending":
      return {
        kind: "challengePending",
        challengeId: cell.challengeId,
        defenderId: cell.defenderId,
        participantIds: [...cell.participantIds],
        closesAt: cell.closesAt,
      };
    case "battle":
      return {
        kind: "battle",
        battleId: cell.battleId,
        playerIds: [...cell.playerIds],
      };
  }
}
