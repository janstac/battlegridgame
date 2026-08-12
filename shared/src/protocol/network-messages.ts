import Type from "typebox";

import {
  BattleIdSchema,
  BattleSnapshotSchema,
  PlayerIdSchema,
  RequestIdSchema,
} from "../domain/index.ts";
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

export const BattleJoinedMessageSchema = Type.Object({
  type: Type.Literal("battleJoined"),
  battleId: BattleIdSchema,
  playerId: PlayerIdSchema,
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
  RoutedServerBattleMessageSchema,
]);
export type NetworkServerMessage = Type.Static<typeof NetworkServerMessageSchema>;
