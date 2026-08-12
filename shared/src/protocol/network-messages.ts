import Type from "typebox";

import {
  BattleParticipantIdSchema,
  BattleIdSchema,
  ChallengeIdSchema,
  PlayerIdSchema,
  RequestIdSchema,
} from "../domain/ids.ts";
import { PositionSchema } from "../domain/coordinate.ts";
import {
  BattleSnapshotSchema,
  ParticipationStatusSchema,
} from "../domain/battle-state.ts";
import {
  WorldDeltaSchema,
  WorldSnapshotSchema,
} from "../domain/world-state.ts";
import { ClientMessageSchema } from "./client-messages.ts";
import { ServerMessageSchema } from "./server-messages.ts";

export const DebugCreateBattleMessageSchema = Type.Object({
  type: Type.Literal("debugCreateBattle"),
  requestId: RequestIdSchema,
  playerIds: Type.Array(PlayerIdSchema),
}, { additionalProperties: false });

export const DebugGetPlayerIdsMessageSchema = Type.Object({
  type: Type.Literal("debugGetPlayerIds"),
  requestId: RequestIdSchema,
}, { additionalProperties: false });

export const LeaveBattleMessageSchema = Type.Object({
  type: Type.Literal("leaveBattle"),
  battleId: BattleIdSchema,
  // Optional while the legacy debug flow sends leave without correlation.
  requestId: Type.Optional(RequestIdSchema),
}, { additionalProperties: false });

export const ChallengeWorldCellMessageSchema = Type.Object({
  type: Type.Literal("challengeWorldCell"),
  requestId: RequestIdSchema,
  position: PositionSchema,
}, { additionalProperties: false });

export const JoinWorldChallengeMessageSchema = Type.Object({
  type: Type.Literal("joinWorldChallenge"),
  requestId: RequestIdSchema,
  challengeId: ChallengeIdSchema,
}, { additionalProperties: false });

export const LeaveWorldChallengeMessageSchema = Type.Object({
  type: Type.Literal("leaveWorldChallenge"),
  requestId: RequestIdSchema,
  challengeId: ChallengeIdSchema,
}, { additionalProperties: false });

export const RequestWorldSnapshotMessageSchema = Type.Object({
  type: Type.Literal("requestWorldSnapshot"),
}, { additionalProperties: false });

export const RoutedClientBattleMessageSchema = Type.Object({
  type: Type.Literal("battleMessage"),
  battleId: BattleIdSchema,
  message: ClientMessageSchema,
}, { additionalProperties: false });

export const NetworkClientMessageSchema = Type.Union([
  DebugCreateBattleMessageSchema,
  DebugGetPlayerIdsMessageSchema,
  LeaveBattleMessageSchema,
  ChallengeWorldCellMessageSchema,
  JoinWorldChallengeMessageSchema,
  LeaveWorldChallengeMessageSchema,
  RequestWorldSnapshotMessageSchema,
  RoutedClientBattleMessageSchema,
]);
export type NetworkClientMessage = Type.Static<typeof NetworkClientMessageSchema>;

export const ConnectedMessageSchema = Type.Object({
  type: Type.Literal("connected"),
  playerId: PlayerIdSchema,
}, { additionalProperties: false });

export const DebugPlayerIdsMessageSchema = Type.Object({
  type: Type.Literal("debugPlayerIds"),
  requestId: RequestIdSchema,
  playerIds: Type.Array(PlayerIdSchema),
}, { additionalProperties: false });

/** A server-hosted mapping from battle-local identity to connection identity. */
export const HostedParticipantSchema = Type.Object({
  participantId: BattleParticipantIdSchema,
  playerId: PlayerIdSchema,
  status: ParticipationStatusSchema,
}, { additionalProperties: false });
export type HostedParticipant = Type.Static<typeof HostedParticipantSchema>;

export const BattleJoinedMessageSchema = Type.Object({
  type: Type.Literal("battleJoined"),
  battleId: BattleIdSchema,
  // Debug-created battles are not attached to a World position.
  worldPosition: Type.Union([PositionSchema, Type.Null()]),
  localParticipantId: BattleParticipantIdSchema,
  roster: Type.Array(HostedParticipantSchema, {
    minItems: 2,
    maxItems: 4,
    uniqueItems: true,
  }),
  snapshot: BattleSnapshotSchema,
  createRequestId: Type.Union([RequestIdSchema, Type.Null()]),
}, { additionalProperties: false });

export const DebugCreateBattleRejectionReasonSchema = Type.Union([
  Type.Literal("debugDisabled"),
  Type.Literal("invalidPlayerCount"),
  Type.Literal("duplicatePlayerIds"),
  Type.Literal("unknownPlayer"),
  Type.Literal("requesterNotIncluded"),
]);
export type DebugCreateBattleRejectionReason = Type.Static<
  typeof DebugCreateBattleRejectionReasonSchema
>;

export const DebugCreateBattleRejectedMessageSchema = Type.Object({
  type: Type.Literal("debugCreateBattleRejected"),
  requestId: RequestIdSchema,
  reason: DebugCreateBattleRejectionReasonSchema,
}, { additionalProperties: false });

export const DebugGetPlayerIdsRejectedMessageSchema = Type.Object({
  type: Type.Literal("debugGetPlayerIdsRejected"),
  requestId: RequestIdSchema,
  reason: Type.Literal("debugDisabled"),
}, { additionalProperties: false });

export const BattleLeftMessageSchema = Type.Object({
  type: Type.Literal("battleLeft"),
  battleId: BattleIdSchema,
  requestId: Type.Optional(RequestIdSchema),
}, { additionalProperties: false });

export const WorldSnapshotMessageSchema = Type.Object({
  type: Type.Literal("worldSnapshot"),
  snapshot: WorldSnapshotSchema,
}, { additionalProperties: false });

export const WorldDeltaMessageSchema = Type.Object({
  type: Type.Literal("worldDelta"),
  fromRevision: WorldDeltaSchema.properties.fromRevision,
  revision: WorldDeltaSchema.properties.revision,
  changes: WorldDeltaSchema.properties.changes,
}, { additionalProperties: false });

export const WorldCommandAcceptedMessageSchema = Type.Object({
  type: Type.Literal("worldCommandAccepted"),
  requestId: RequestIdSchema,
}, { additionalProperties: false });

export const WorldCommandRejectionReasonSchema = Type.Union([
  Type.Literal("invalidTarget"),
  Type.Literal("selfChallenge"),
  Type.Literal("unknownChallenge"),
  Type.Literal("challengeClosed"),
  Type.Literal("alreadyJoined"),
  Type.Literal("challengeFull"),
  Type.Literal("notParticipant"),
]);
export type WorldCommandRejectionReason = Type.Static<
  typeof WorldCommandRejectionReasonSchema
>;

export const WorldCommandRejectedMessageSchema = Type.Object({
  type: Type.Literal("worldCommandRejected"),
  requestId: RequestIdSchema,
  reason: WorldCommandRejectionReasonSchema,
}, { additionalProperties: false });

export const RoutedServerBattleMessageSchema = Type.Object({
  type: Type.Literal("battleMessage"),
  battleId: BattleIdSchema,
  message: ServerMessageSchema,
}, { additionalProperties: false });

export const NetworkServerMessageSchema = Type.Union([
  ConnectedMessageSchema,
  DebugPlayerIdsMessageSchema,
  BattleJoinedMessageSchema,
  DebugCreateBattleRejectedMessageSchema,
  DebugGetPlayerIdsRejectedMessageSchema,
  BattleLeftMessageSchema,
  WorldSnapshotMessageSchema,
  WorldDeltaMessageSchema,
  WorldCommandAcceptedMessageSchema,
  WorldCommandRejectedMessageSchema,
  RoutedServerBattleMessageSchema,
]);
export type NetworkServerMessage = Type.Static<typeof NetworkServerMessageSchema>;
