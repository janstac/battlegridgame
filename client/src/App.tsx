import type { PlayerId, Position } from "@grid-game/shared";
import { useEffect, useRef, useState } from "react";

import {
  createDemoBattle,
  createDemoRuntime,
  DEMO_PLAYERS,
  DemoControls,
  type DemoRuntime,
} from "./demo/index.ts";
import { BattleView } from "./view/index.ts";

/** Root composition for the standalone local battle demo. */
export function App() {
  const [runtime, setRuntime] = useState<DemoRuntime | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId>(
    DEMO_PLAYERS[0],
  );
  const selectedPlayerIdRef = useRef(selectedPlayerId);
  selectedPlayerIdRef.current = selectedPlayerId;

  useEffect(() => {
    // Effects can be cleaned up and replayed without a new render in StrictMode.
    // Constructing here ensures a disposed session is never started a second time.
    const nextRuntime = createDemoRuntime();
    nextRuntime.session.setActivePlayer(selectedPlayerIdRef.current);
    nextRuntime.controller.start();
    setRuntime(nextRuntime);

    // The controller owns the session timer, so one cleanup releases both.
    return () => nextRuntime.controller.dispose();
  }, []);

  const selectPlayer = (playerId: PlayerId) => {
    runtime?.session.setActivePlayer(playerId);
    setSelectedPlayerId(playerId);
  };

  const reset = () => {
    runtime?.session.reset(createDemoBattle(), selectedPlayerId);
  };

  const activateCell = (position: Position) => {
    runtime?.controller.incrementCell(position);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Client-only simulation</p>
        <h1>Grid Battle</h1>
        <p>
          This demo uses the same model, controller, and protocol boundary as a
          networked client. Its replaceable local session is the authority.
        </p>
      </header>

      <DemoControls
        players={DEMO_PLAYERS}
        selectedPlayerId={selectedPlayerId}
        onSelectPlayer={selectPlayer}
        onReset={reset}
      />
      {runtime === null ? (
        <p className="loading-status">Starting local battle…</p>
      ) : (
        <BattleView
          model={runtime.model}
          selectedPlayerId={selectedPlayerId}
          onCellActivate={activateCell}
        />
      )}
    </main>
  );
}
