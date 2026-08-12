import Type from "typebox";

import {
  PositionSchema,
  RequestIdSchema,
} from "../domain/index.ts";

/** A client's intent to increment one of its cells. */
export const IncrementCellMessageSchema = Type.Object(
  {
    type: Type.Literal("incrementCell"),
    requestId: RequestIdSchema,
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
