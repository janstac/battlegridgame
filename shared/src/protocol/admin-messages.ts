import Type from "typebox";

import { PositionSchema } from "../domain/coordinate.ts";
import {
  BattleIdSchema,
  PlayerIdSchema,
  RequestIdSchema,
  WorldRevisionSchema,
} from "../domain/ids.ts";
import {
  OccupiedWorldCellSchema,
  UnoccupiedWorldCellSchema,
  WorldCellSchema,
} from "../domain/world-cell.ts";
import {
  WorldCellChangeSchema,
  WorldSnapshotSchema,
} from "../domain/world-state.ts";
import { BattleSnapshotSchema } from "../domain/battle-state.ts";
import { HostedParticipantSchema } from "./network-messages.ts";

export const ConnectAsPlayerMessageSchema = Type.Object(
  { type: Type.Literal("connectAsPlayer") },
  { additionalProperties: false },
);

export type ConnectAsPlayerMessage = Type.Static<
  typeof ConnectAsPlayerMessageSchema
>;

export const ConnectAsAdminMessageSchema = Type.Object(
  {
    type: Type.Literal("connectAsAdmin"),
    token: Type.String(),
  },
  { additionalProperties: false },
);

export type ConnectAsAdminMessage = Type.Static<
  typeof ConnectAsAdminMessageSchema
>;

export const AnonymousNetworkClientMessageSchema = Type.Union([
  ConnectAsPlayerMessageSchema,
  ConnectAsAdminMessageSchema,
]);

export type AnonymousNetworkClientMessage = Type.Static<
  typeof AnonymousNetworkClientMessageSchema
>;

export const ConnectedAsAdminMessageSchema = Type.Object(
  { type: Type.Literal("connectedAsAdmin") },
  { additionalProperties: false },
);

export type ConnectedAsAdminMessage = Type.Static<
  typeof ConnectedAsAdminMessageSchema
>;

export const AdminEditableWorldCellSchema = Type.Union([
  UnoccupiedWorldCellSchema,
  OccupiedWorldCellSchema,
]);

export type AdminEditableWorldCell = Type.Static<
  typeof AdminEditableWorldCellSchema
>;

export const AdminWorldCellReplacementSchema = Type.Object(
  {
    position: PositionSchema,
    expected: WorldCellSchema,
    next: AdminEditableWorldCellSchema,
  },
  { additionalProperties: false },
);

export type AdminWorldCellReplacement = Type.Static<
  typeof AdminWorldCellReplacementSchema
>;

export const AdminListPlayersMessageSchema = Type.Object(
  {
    type: Type.Literal("adminListPlayers"),
    requestId: RequestIdSchema,
  },
  { additionalProperties: false },
);

export type AdminListPlayersMessage = Type.Static<
  typeof AdminListPlayersMessageSchema
>;

export const AdminGetWorldMessageSchema = Type.Object(
  {
    type: Type.Literal("adminGetWorld"),
    requestId: RequestIdSchema,
  },
  { additionalProperties: false },
);

export type AdminGetWorldMessage = Type.Static<
  typeof AdminGetWorldMessageSchema
>;

export const AdminListBattlesMessageSchema = Type.Object(
  {
    type: Type.Literal("adminListBattles"),
    requestId: RequestIdSchema,
  },
  { additionalProperties: false },
);

export type AdminListBattlesMessage = Type.Static<
  typeof AdminListBattlesMessageSchema
>;

export const AdminStartBattleMessageSchema = Type.Object(
  {
    type: Type.Literal("adminStartBattle"),
    requestId: RequestIdSchema,
    playerIds: Type.Array(PlayerIdSchema, {
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export type AdminStartBattleMessage = Type.Static<
  typeof AdminStartBattleMessageSchema
>;

export const AdminReplaceWorldCellsMessageSchema = Type.Object(
  {
    type: Type.Literal("adminReplaceWorldCells"),
    requestId: RequestIdSchema,
    changes: Type.Array(AdminWorldCellReplacementSchema, {
      minItems: 1,
      maxItems: 256,
    }),
  },
  { additionalProperties: false },
);

export type AdminReplaceWorldCellsMessage = Type.Static<
  typeof AdminReplaceWorldCellsMessageSchema
>;

export const AdminNetworkClientMessageSchema = Type.Union([
  AdminListPlayersMessageSchema,
  AdminGetWorldMessageSchema,
  AdminListBattlesMessageSchema,
  AdminStartBattleMessageSchema,
  AdminReplaceWorldCellsMessageSchema,
]);

export type AdminNetworkClientMessage = Type.Static<
  typeof AdminNetworkClientMessageSchema
>;

export const AdminBattleSchema = Type.Object(
  {
    battleId: BattleIdSchema,
    worldPosition: Type.Union([PositionSchema, Type.Null()]),
    roster: Type.Array(HostedParticipantSchema, {
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
    }),
    snapshot: BattleSnapshotSchema,
  },
  { additionalProperties: false },
);

export type AdminBattle = Type.Static<typeof AdminBattleSchema>;

export const AdminErrorCodeSchema = Type.Union([
  Type.Literal("invalidRequest"),
  Type.Literal("unknownPlayer"),
  Type.Literal("invalidRoster"),
  Type.Literal("conflict"),
  Type.Literal("lifecycleNotFound"),
  Type.Literal("lifecycleCancellationFailed"),
  Type.Literal("battleLimitReached"),
  Type.Literal("internal"),
]);

export type AdminErrorCode = Type.Static<typeof AdminErrorCodeSchema>;

export const AdminPlayersMessageSchema = Type.Object(
  {
    type: Type.Literal("adminPlayers"),
    requestId: RequestIdSchema,
    playerIds: Type.Array(PlayerIdSchema),
  },
  { additionalProperties: false },
);

export type AdminPlayersMessage = Type.Static<
  typeof AdminPlayersMessageSchema
>;

export const AdminWorldMessageSchema = Type.Object(
  {
    type: Type.Literal("adminWorld"),
    requestId: RequestIdSchema,
    snapshot: WorldSnapshotSchema,
  },
  { additionalProperties: false },
);

export type AdminWorldMessage = Type.Static<typeof AdminWorldMessageSchema>;

export const AdminBattlesMessageSchema = Type.Object(
  {
    type: Type.Literal("adminBattles"),
    requestId: RequestIdSchema,
    battles: Type.Array(AdminBattleSchema),
  },
  { additionalProperties: false },
);

export type AdminBattlesMessage = Type.Static<
  typeof AdminBattlesMessageSchema
>;

export const AdminBattleStartedMessageSchema = Type.Object(
  {
    type: Type.Literal("adminBattleStarted"),
    requestId: RequestIdSchema,
    battle: AdminBattleSchema,
  },
  { additionalProperties: false },
);

export type AdminBattleStartedMessage = Type.Static<
  typeof AdminBattleStartedMessageSchema
>;

export const AdminWorldCellsReplacedMessageSchema = Type.Object(
  {
    type: Type.Literal("adminWorldCellsReplaced"),
    requestId: RequestIdSchema,
    revision: WorldRevisionSchema,
    changes: Type.Array(WorldCellChangeSchema),
  },
  { additionalProperties: false },
);

export type AdminWorldCellsReplacedMessage = Type.Static<
  typeof AdminWorldCellsReplacedMessageSchema
>;

export const AdminErrorMessageSchema = Type.Object(
  {
    type: Type.Literal("adminError"),
    requestId: RequestIdSchema,
    code: AdminErrorCodeSchema,
    message: Type.String(),
  },
  { additionalProperties: false },
);

export type AdminErrorMessage = Type.Static<
  typeof AdminErrorMessageSchema
>;

export const AdminNetworkServerMessageSchema = Type.Union([
  AdminPlayersMessageSchema,
  AdminWorldMessageSchema,
  AdminBattlesMessageSchema,
  AdminBattleStartedMessageSchema,
  AdminWorldCellsReplacedMessageSchema,
  AdminErrorMessageSchema,
]);

export type AdminNetworkServerMessage = Type.Static<
  typeof AdminNetworkServerMessageSchema
>;

export const AdminConnectionServerMessageSchema = Type.Union([
  ConnectedAsAdminMessageSchema,
  AdminNetworkServerMessageSchema,
]);

export type AdminConnectionServerMessage = Type.Static<
  typeof AdminConnectionServerMessageSchema
>;
