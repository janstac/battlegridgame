import { BattleState } from "../domain/index.ts";
import type { BattleStateMessage } from "./server-messages.ts";

/** Mechanically projects one authoritative fact into shared battle storage. */
export function applyBattleServerMessage(
  state: BattleState,
  message: BattleStateMessage,
): BattleState {
  if (message.type === "battleSnapshot") {
    return BattleState.restore(message.snapshot);
  }

  state.setTick(message.tick);
  switch (message.type) {
    case "cellIncremented":
    case "cellCaptured":
      state.replaceCell(message.position, message.cell);
      break;
    case "splitScheduled":
      state.addPendingSplit(message.split);
      break;
    case "cellSplit":
      state.replaceCell(message.position, message.cell);
      state.removePendingSplit(message.position);
      break;
    case "cooldownChanged":
      state.replaceCooldown(message.cooldown);
      break;
    case "battleStatusChanged":
      state.replaceStatus(message.status);
      break;
    case "pendingSplitsCleared":
      state.clearPendingSplits();
      break;
  }
  return state;
}
