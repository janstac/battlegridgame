import type { PlayerId, Position } from "@grid-game/shared";
import { useEffect, useState } from "react";

import {
  createDemoBattle,
  createDemoRuntime,
  DEMO_PLAYERS,
  DemoControls,
} from "./demo/index.ts";
import { BattleView } from "./view/index.ts";

/** Root composition for the standalone local battle demo. */
export function App() {
  const [runtime] = useState(createDemoRuntime);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId>(
    DEMO_PLAYERS[0],
  );

  useEffect(() => {
    runtime.controller.start();
    // The controller owns the session timer, so one cleanup releases both.
    return () => runtime.controller.dispose();
  }, [runtime]);

  const selectPlayer = (playerId: PlayerId) => {
    runtime.session.setActivePlayer(playerId);
    setSelectedPlayerId(playerId);
  };

  const reset = () => {
    runtime.session.reset(createDemoBattle(), selectedPlayerId);
  };

  const activateCell = (position: Position) => {
    runtime.controller.incrementCell(position);
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
      <BattleView
        model={runtime.model}
        selectedPlayerId={selectedPlayerId}
        onCellActivate={activateCell}
      />
    </main>
  );
}
