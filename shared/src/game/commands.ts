import Type from "typebox";

import { PlayerIdSchema, PositionSchema } from "../domain/index.ts";

/** Runtime schema for a player's intent to increment one owned cell. */
export const IncrementCellCommandSchema = Type.Object(
  {
    kind: Type.Literal("incrementCell"),
    position: PositionSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for all commands accepted by a battle engine. */
export const BattleCommandSchema = IncrementCellCommandSchema;
/** Player intent passed into the deterministic engine. */
export type BattleCommand = Type.Static<typeof BattleCommandSchema>;

/** Runtime schema for authoritative information accompanying a command. */
export const CommandContextSchema = Type.Object(
  { playerId: PlayerIdSchema },
  { additionalProperties: false },
);
/** Trusted actor context supplied by a session rather than the client payload. */
export type CommandContext = Type.Static<typeof CommandContextSchema>;
