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
        kind: "occupied", playerId: event.playerId, count: event.nextCount,
      }, source: event.source }];
    case "cellCaptured":
      return [{ type: "cellCaptured", tick, position: { ...event.position }, cell: {
        kind: "occupied", playerId: event.playerId, count: event.nextCount,
      } }];
    case "splitScheduled":
      return [{ type: "splitScheduled", tick, split: {
        position: { ...event.position }, dueTick: event.dueTick, sequence: event.sequence,
      } }];
    case "cellSplit":
      return [{ type: "cellSplit", tick, position: { ...event.position }, cell: { kind: "empty" } }];
    case "cooldownStarted":
      return [{ type: "cooldownChanged", tick, cooldown: {
        playerId: event.playerId, nextActionTick: event.nextActionTick,
      } }];
    case "battleWon":
      return [
        { type: "pendingSplitsCleared", tick },
        { type: "battleStatusChanged", tick, status: {
          kind: "finished", winnerId: event.winnerId,
        } },
      ];
  }
}
