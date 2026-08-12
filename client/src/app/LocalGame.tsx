import type { PlayerId } from "@grid-game/shared";
import { useEffect, useReducer, useRef, useState } from "react";

import {
  createDemoRuntime,
  DEMO_PLAYERS,
  DemoControls,
  type DemoRuntime,
} from "../demo/index.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { GamePage } from "../ui/GamePage.tsx";
import { StatusNotice } from "../ui/StatusNotice.tsx";
import { BattleView, type PlayerColorId } from "../view/index.ts";
import styles from "./LocalGame.module.css";

const DEMO_PLAYER_COLOR_IDS: ReadonlyMap<PlayerId, PlayerColorId> = new Map([
  [DEMO_PLAYERS[0], 0],
  [DEMO_PLAYERS[1], 1],
  [DEMO_PLAYERS[2], 2],
]);

export type LocalGameProps = Readonly<{
  onBack(): void;
}>;

/** Owns the complete lifecycle of the replaceable local battle authority. */
export function LocalGame({ onBack }: LocalGameProps) {
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
    // Identity lives in ClientBattleState; refresh the selector outside the
    // subscribed BattleView after changing it.
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
    <GamePage
      eyebrow="Client-only simulation"
      title="Grid Battle"
      description={
        <>
          This demo uses the same asynchronous message boundary as a networked
          client. Its replaceable local connection is the authority.
        </>
      }
    >
      <DemoControls
        players={DEMO_PLAYERS}
        selectedPlayerId={runtime?.battle.localPlayerId ?? DEMO_PLAYERS[0]}
        onSelectPlayer={selectPlayer}
        onReset={reset}
      />
      <ActionButton
        className={styles.backAction}
        variant="secondary"
        type="button"
        onClick={onBack}
      >
        Back to game modes
      </ActionButton>
      {runtime === null ? (
        <StatusNotice kind="progress">Starting local battle…</StatusNotice>
      ) : (
        <BattleView
          battle={runtime.battle}
          playerColorIds={DEMO_PLAYER_COLOR_IDS}
        />
      )}
    </GamePage>
  );
}
