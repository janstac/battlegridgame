import Type from "typebox";

import {
  PlayerIdSchema,
  PositionSchema,
  RequestIdSchema,
} from "../domain/index.ts";

/** A client's intent to increment one cell as its locally selected player. */
export const IncrementCellMessageSchema = Type.Object(
  {
    type: Type.Literal("incrementCell"),
    requestId: RequestIdSchema,
    playerId: PlayerIdSchema,
    position: PositionSchema,
  },
  { additionalProperties: false },
);

/** Round-trip probe used to anchor the client's estimated simulation tick. */
export const TickProbeMessageSchema = Type.Object(
  {
    type: Type.Literal("tickProbe"),
    probeId: RequestIdSchema,
  },
  { additionalProperties: false },
);

export const ClientMessageSchema = Type.Union([
  IncrementCellMessageSchema,
  TickProbeMessageSchema,
]);
export type ClientMessage = Type.Static<typeof ClientMessageSchema>;
