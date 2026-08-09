import {
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type PlayerId,
} from "@grid-game/shared";

import { ClientBattleState } from "../model/index.ts";
import { LocalBattleEngineConnection } from "../session/index.ts";
import { createDemoBattle, DEMO_PLAYERS } from "./createDemoBattle.ts";

export type DemoRuntime = Readonly<{
  battle: ClientBattleState;
}>;

/** Constructs the local authority through the same async boundary as a server. */
export async function createDemoRuntime(
  localPlayerId: PlayerId = DEMO_PLAYERS[0],
): Promise<DemoRuntime> {
  const connection = await LocalBattleEngineConnection.connect({
    setup: createDemoBattle(),
    config: DEFAULT_BATTLE_CONFIG,
    // Half a second at 20 Hz keeps feedback visible without slowing the demo.
    cooldownPolicy: new FixedCooldownPolicy(10),
  });
  return { battle: new ClientBattleState(connection, localPlayerId) };
}
