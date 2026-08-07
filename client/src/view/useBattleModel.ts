import { useSyncExternalStore } from "react";

import type { BattleModel, BattleModelState } from "../model/index.ts";

/** Subscribes a React component to the framework-independent battle model. */
export function useBattleModel(model: BattleModel): BattleModelState {
  return useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot,
  );
}
