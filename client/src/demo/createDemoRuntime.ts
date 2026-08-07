import { FixedCooldownPolicy } from "@grid-game/shared";

import { BattleController } from "../controller/index.ts";
import { BattleModel } from "../model/index.ts";
import { LocalBattleSession } from "../session/index.ts";
import { createDemoBattle, DEMO_PLAYERS } from "./createDemoBattle.ts";

/** Long-lived objects composing the local MVC demo. */
export type DemoRuntime = Readonly<{
  model: BattleModel;
  controller: BattleController;
  session: LocalBattleSession;
}>;

/** Constructs a fresh local authority and its transport-neutral MVC adapters. */
export function createDemoRuntime(): DemoRuntime {
  const model = new BattleModel();
  const session = new LocalBattleSession({
    setup: createDemoBattle(),
    playerId: DEMO_PLAYERS[0],
    // Half a second at 20 Hz keeps feedback visible without slowing the demo.
    cooldownPolicy: new FixedCooldownPolicy(10),
  });
  const controller = new BattleController(model, session);
  return { model, controller, session };
}
