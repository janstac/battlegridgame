import Type from "typebox";

import {
  BattleIdSchema,
  BattleSnapshotSchema,
  RequestIdSchema,
} from "../domain/index.ts";
import {
  BattleEventSchema,
  CommandRejectionReasonSchema,
} from "../game/events.ts";

/** Runtime schema for initial or replacement authoritative state. */
export const BattleSnapshotMessageSchema = Type.Object(
  {
    type: Type.Literal("battleSnapshot"),
    snapshot: BattleSnapshotSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema acknowledging an accepted client command. */
export const CommandAcceptedMessageSchema = Type.Object(
  {
    type: Type.Literal("commandAccepted"),
    requestId: RequestIdSchema,
    events: Type.Array(BattleEventSchema),
    snapshot: BattleSnapshotSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema rejecting a client command without changing state. */
export const CommandRejectedMessageSchema = Type.Object(
  {
    type: Type.Literal("commandRejected"),
    requestId: RequestIdSchema,
    battleId: BattleIdSchema,
    reason: CommandRejectionReasonSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for state changed by a logical simulation tick. */
export const BattleAdvancedMessageSchema = Type.Object(
  {
    type: Type.Literal("battleAdvanced"),
    events: Type.Array(BattleEventSchema),
    snapshot: BattleSnapshotSchema,
  },
  { additionalProperties: false },
);

/** Runtime schema for all authoritative session-to-client messages. */
export const ServerMessageSchema = Type.Union([
  BattleSnapshotMessageSchema,
  CommandAcceptedMessageSchema,
  CommandRejectedMessageSchema,
  BattleAdvancedMessageSchema,
]);
/** Validated authoritative message emitted by a local or network session. */
export type ServerMessage = Type.Static<typeof ServerMessageSchema>;
