import Type from "typebox";

const SAFE_ID_MAX = Number.MAX_SAFE_INTEGER;

/** Runtime schema for a non-empty player identifier. */
export const PlayerIdSchema = Type.String({ minLength: 1 });
/** Identifies a player within game and protocol state. */
export type PlayerId = Type.Static<typeof PlayerIdSchema>;

/** Runtime schema for a stable non-negative identifier local to one battle. */
export const BattleParticipantIdSchema = Type.Integer({
  minimum: 0,
  maximum: SAFE_ID_MAX,
});
/** Identifies one participant only within its containing battle. */
export type BattleParticipantId = Type.Static<
  typeof BattleParticipantIdSchema
>;

/** Runtime schema for a non-empty server-assigned battle identifier. */
export const BattleIdSchema = Type.String({ minLength: 1 });
/** Identifies one hosted battle in the outer network protocol. */
export type BattleId = Type.Static<typeof BattleIdSchema>;

/** Runtime schema for a non-empty server-assigned pending challenge identifier. */
export const ChallengeIdSchema = Type.String({ minLength: 1 });
/** Identifies one pending World challenge lifetime. */
export type ChallengeId = Type.Static<typeof ChallengeIdSchema>;

/** Runtime schema for a process-monotonic Waiting challenge identifier. */
export const WaitingIdSchema = Type.Integer({
  minimum: 1,
  maximum: SAFE_ID_MAX,
});
/** Orders Waiting challenge lifetimes without exposing scheduler internals. */
export type WaitingId = Type.Static<typeof WaitingIdSchema>;

/** Runtime schema for a client-generated request identifier. */
export const RequestIdSchema = Type.String({ minLength: 1 });
/** Correlates a client command with its server response. */
export type RequestId = Type.Static<typeof RequestIdSchema>;

/** Runtime schema for a non-negative World state revision. */
export const WorldRevisionSchema = Type.Integer({
  minimum: 0,
  maximum: SAFE_ID_MAX,
});
/** Monotonically identifies a committed World state. */
export type WorldRevision = Type.Static<typeof WorldRevisionSchema>;

/** Runtime schema for a Unix timestamp expressed in milliseconds. */
export const UnixTimestampMsSchema = Type.Integer({
  minimum: 0,
  maximum: SAFE_ID_MAX,
});
/** Absolute server time in Unix milliseconds. */
export type UnixTimestampMs = Type.Static<typeof UnixTimestampMsSchema>;
