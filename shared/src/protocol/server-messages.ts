import Type from "typebox";

import {
  BattleSnapshotSchema,
  BattleStatusSchema,
  BattleCellSchema,
  OccupiedCellSchema,
  PendingSplitSchema,
  BattleParticipantSchema,
  ParticipantCooldownSchema,
  PositionSchema,
  RequestIdSchema,
  TickSchema,
} from "../domain/index.ts";
import { CommandRejectionReasonSchema } from "../game/events.ts";

/** Complete state used only for initialization. */
export const BattleSnapshotMessageSchema = Type.Object(
  { type: Type.Literal("battleSnapshot"), snapshot: BattleSnapshotSchema },
  { additionalProperties: false },
);

export const CellIncrementedMessageSchema = Type.Object(
  {
    type: Type.Literal("cellIncremented"),
    tick: TickSchema,
    position: PositionSchema,
    cell: OccupiedCellSchema,
    source: Type.Union([Type.Literal("command"), Type.Literal("split")]),
  },
  { additionalProperties: false },
);

export const CellCapturedMessageSchema = Type.Object(
  {
    type: Type.Literal("cellCaptured"),
    tick: TickSchema,
    position: PositionSchema,
    cell: OccupiedCellSchema,
  },
  { additionalProperties: false },
);

export const SplitScheduledMessageSchema = Type.Object(
  {
    type: Type.Literal("splitScheduled"),
    tick: TickSchema,
    split: PendingSplitSchema,
  },
  { additionalProperties: false },
);

export const CellSplitMessageSchema = Type.Object(
  {
    type: Type.Literal("cellSplit"),
    tick: TickSchema,
    position: PositionSchema,
    cell: BattleCellSchema,
  },
  { additionalProperties: false },
);

export const CooldownChangedMessageSchema = Type.Object(
  {
    type: Type.Literal("cooldownChanged"),
    tick: TickSchema,
    cooldown: ParticipantCooldownSchema,
  },
  { additionalProperties: false },
);

export const ParticipantChangedMessageSchema = Type.Object(
  {
    type: Type.Literal("participantChanged"),
    tick: TickSchema,
    participant: BattleParticipantSchema,
  },
  { additionalProperties: false },
);

export const BattleStatusChangedMessageSchema = Type.Object(
  {
    type: Type.Literal("battleStatusChanged"),
    tick: TickSchema,
    status: BattleStatusSchema,
  },
  { additionalProperties: false },
);

/** Authoritative removal of all scheduled work, normally on battle completion. */
export const PendingSplitsClearedMessageSchema = Type.Object(
  {
    type: Type.Literal("pendingSplitsCleared"),
    tick: TickSchema,
  },
  { additionalProperties: false },
);

export const CommandRejectedMessageSchema = Type.Object(
  {
    type: Type.Literal("commandRejected"),
    requestId: RequestIdSchema,
    reason: CommandRejectionReasonSchema,
  },
  { additionalProperties: false },
);

export const TickProbeResultMessageSchema = Type.Object(
  {
    type: Type.Literal("tickProbeResult"),
    probeId: RequestIdSchema,
    tick: TickSchema,
  },
  { additionalProperties: false },
);

export const BattleStateMessageSchema = Type.Union([
  BattleSnapshotMessageSchema,
  CellIncrementedMessageSchema,
  CellCapturedMessageSchema,
  SplitScheduledMessageSchema,
  CellSplitMessageSchema,
  CooldownChangedMessageSchema,
  ParticipantChangedMessageSchema,
  BattleStatusChangedMessageSchema,
  PendingSplitsClearedMessageSchema,
]);
export type BattleStateMessage = Type.Static<typeof BattleStateMessageSchema>;

export type CommandRejectedMessage = Type.Static<
  typeof CommandRejectedMessageSchema
>;
export type TickProbeResultMessage = Type.Static<
  typeof TickProbeResultMessageSchema
>;

export const ServerMessageSchema = Type.Union([
  BattleStateMessageSchema,
  CommandRejectedMessageSchema,
  TickProbeResultMessageSchema,
]);
export type ServerMessage = Type.Static<typeof ServerMessageSchema>;
