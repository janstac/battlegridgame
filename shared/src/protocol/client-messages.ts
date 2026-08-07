import Type from "typebox";

import {
  BattleIdSchema,
  PositionSchema,
  RequestIdSchema,
} from "../domain/index.ts";

/** Runtime schema for an increment request sent by a client session. */
export const IncrementCellMessageSchema = Type.Object(
  {
    type: Type.Literal("incrementCell"),
    requestId: RequestIdSchema,
    battleId: BattleIdSchema,
    position: PositionSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for all client-to-session messages. */
export const ClientMessageSchema = IncrementCellMessageSchema;
/** Validated message accepted from a local or network client. */
export type ClientMessage = Type.Static<typeof ClientMessageSchema>;
