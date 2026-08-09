import Type from "typebox";

/** Runtime schema for a non-empty player identifier. */
export const PlayerIdSchema = Type.String({ minLength: 1 });
/** Identifies a player within game and protocol state. */
export type PlayerId = Type.Static<typeof PlayerIdSchema>;

/** Runtime schema for a client-generated request identifier. */
export const RequestIdSchema = Type.String({ minLength: 1 });
/** Correlates a client command with its server response. */
export type RequestId = Type.Static<typeof RequestIdSchema>;
