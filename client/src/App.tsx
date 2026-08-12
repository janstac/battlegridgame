import type { PlayerId } from "@grid-game/shared";
import { useEffect, useReducer, useRef, useState } from "react";

import {
  createDemoRuntime,
  DEMO_PLAYERS,
  DemoControls,
  type DemoRuntime,
} from "./demo/index.ts";
import {
  BattleView,
  type PlayerColorId,
} from "./view/index.ts";

const DEMO_PLAYER_COLOR_IDS: ReadonlyMap<PlayerId, PlayerColorId> = new Map([
  [DEMO_PLAYERS[0], 0],
  [DEMO_PLAYERS[1], 1],
  [DEMO_PLAYERS[2], 2],
]);

/** Root composition for the standalone local battle demo. */
export function App() {
  const [runtime, setRuntime] = useState<DemoRuntime | null>(null);
  const runtimeRef = useRef<DemoRuntime | null>(null);
  const runtimeGeneration = useRef(0);
  const [, refreshControls] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const generation = ++runtimeGeneration.current;
    void createDemoRuntime().then((nextRuntime) => {
      if (generation !== runtimeGeneration.current) {
        void nextRuntime.battle.dispose();
        return;
      }
      runtimeRef.current = nextRuntime;
      setRuntime(nextRuntime);
    });
    return () => {
      runtimeGeneration.current += 1;
      const current = runtimeRef.current;
      runtimeRef.current = null;
      if (current !== null) void current.battle.dispose();
    };
  }, []);

  const selectPlayer = (playerId: PlayerId) => {
    runtime?.battle.setLocalPlayerId(playerId);
    // The identity still lives exclusively in ClientBattleState; this refreshes
    // the demo-only selector which sits outside BattleView's subscription.
    refreshControls();
  };

  const reset = () => {
    if (runtime === null) return;
    const localPlayerId = runtime.battle.localPlayerId;
    const generation = ++runtimeGeneration.current;
    runtimeRef.current = null;
    setRuntime(null);
    void runtime.battle.dispose().then(async () => {
      const nextRuntime = await createDemoRuntime(localPlayerId);
      if (generation !== runtimeGeneration.current) {
        await nextRuntime.battle.dispose();
        return;
      }
      runtimeRef.current = nextRuntime;
      setRuntime(nextRuntime);
    });
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Client-only simulation</p>
        <h1>Grid Battle</h1>
        <p>
          This demo uses the same asynchronous message boundary as a networked
          client. Its replaceable local connection is the authority.
        </p>
      </header>

      <DemoControls
        players={DEMO_PLAYERS}
        selectedPlayerId={runtime?.battle.localPlayerId ?? DEMO_PLAYERS[0]}
        onSelectPlayer={selectPlayer}
        onReset={reset}
      />
      {runtime === null ? (
        <p className="loading-status">Starting local battle…</p>
      ) : (
        <BattleView
          battle={runtime.battle}
          playerColorIds={DEMO_PLAYER_COLOR_IDS}
        />
      )}
    </main>
  );
}
