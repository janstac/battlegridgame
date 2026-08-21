import type { BattleEvent } from "../game/index.ts";
import type { BattleStateMessage } from "./server-messages.ts";

/** Converts one engine event into ordered authoritative wire facts. */
export function battleEventToServerMessages(
  event: BattleEvent,
  tick: number,
): BattleStateMessage[] {
  switch (event.kind) {
    case "cellIncremented":
      return [{ type: "cellIncremented", tick, position: { ...event.position }, cell: {
        kind: "occupied", participantId: event.participantId, count: event.nextCount,
      }, source: event.source }];
    case "cellCaptured":
      return [{ type: "cellCaptured", tick, position: { ...event.position }, cell: {
        kind: "occupied", participantId: event.participantId, count: event.nextCount,
      } }];
    case "splitScheduled":
      return [{ type: "splitScheduled", tick, split: {
        position: { ...event.position }, dueTick: event.dueTick, sequence: event.sequence,
      } }];
    case "cellSplit":
      return [{ type: "cellSplit", tick, position: { ...event.position }, cell: { kind: "empty" } }];
    case "cooldownStarted":
      return [{ type: "cooldownChanged", tick, cooldown: {
        participantId: event.participantId,
        nextActionTick: event.nextActionTick,
        durationTicks: event.durationTicks,
        acceptedActionCount: event.acceptedActionCount,
      } }];
    case "participantStatusChanged":
      return [{ type: "participantChanged", tick, participant: {
        participantId: event.participantId, status: event.status,
      } }];
    case "battleFinished":
      return [
        { type: "pendingSplitsCleared", tick },
        { type: "battleStatusChanged", tick, status: {
          kind: "finished", winnerId: event.winnerId,
        } },
      ];
  }
}
