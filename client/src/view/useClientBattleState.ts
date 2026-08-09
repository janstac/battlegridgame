import { useSyncExternalStore } from "react";

import type {
  ClientBattleState,
  ClientBattleViewState,
} from "../model/index.ts";

/** Subscribes React to the framework-independent client battle projection. */
export function useClientBattleState(
  battle: ClientBattleState,
): ClientBattleViewState {
  return useSyncExternalStore(
    battle.subscribe,
    battle.getSnapshot,
    battle.getSnapshot,
  );
}
