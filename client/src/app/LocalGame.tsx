import type { BattleParticipantId, PlayerId } from "@grid-game/shared";
import { useEffect, useRef, useState } from "react";

import {
  createDemoRuntime,
  DEMO_PARTICIPANT_IDS,
  DEMO_PLAYERS,
  DEMO_ROSTER,
  DemoControls,
  type DemoRuntime,
} from "../demo/index.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { GamePage } from "../ui/GamePage.tsx";
import { StatusNotice } from "../ui/StatusNotice.tsx";
import { BattleView, type PlayerColorId } from "../view/index.ts";
import styles from "./LocalGame.module.css";

const DEMO_PARTICIPANT_COLOR_IDS: ReadonlyMap<BattleParticipantId, PlayerColorId> = new Map([
  [DEMO_PARTICIPANT_IDS[0], 0],
  [DEMO_PARTICIPANT_IDS[1], 1],
  [DEMO_PARTICIPANT_IDS[2], 2],
]);
const DEMO_PARTICIPANT_LABELS = new Map(
  [...DEMO_ROSTER].map(([playerId, participantId]) => [participantId, playerId]),
);

export type LocalGameProps = Readonly<{
  onBack(): void;
}>;

/** Owns the complete lifecycle of the replaceable local battle authority. */
export function LocalGame({ onBack }: LocalGameProps) {
  const [runtime, setRuntime] = useState<DemoRuntime | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId>(DEMO_PLAYERS[0]);
  const selectedPlayerRef = useRef<PlayerId>(DEMO_PLAYERS[0]);
  const runtimeRef = useRef<DemoRuntime | null>(null);
  const runtimeGeneration = useRef(0);

  async function createAndInstallRuntime(generation: number, initialPlayerId: PlayerId) {
    let playerId = initialPlayerId;
    let nextRuntime = await createDemoRuntime(playerId);
    while (playerId !== selectedPlayerRef.current) {
      await nextRuntime.battle.dispose();
      playerId = selectedPlayerRef.current;
      nextRuntime = await createDemoRuntime(playerId);
    }
    if (generation !== runtimeGeneration.current) {
      await nextRuntime.battle.dispose();
      return;
    }
    runtimeRef.current = nextRuntime;
    setRuntime(nextRuntime);
  }

  useEffect(() => {
    const generation = ++runtimeGeneration.current;
    void createAndInstallRuntime(generation, selectedPlayerRef.current);
    return () => {
      runtimeGeneration.current += 1;
      const current = runtimeRef.current;
      runtimeRef.current = null;
      if (current !== null) void current.battle.dispose();
    };
  }, []);

  const selectPlayer = (playerId: PlayerId) => {
    if (playerId === selectedPlayerId) return;
    selectedPlayerRef.current = playerId;
    setSelectedPlayerId(playerId);
    replaceRuntime(playerId);
  };

  const replaceRuntime = (playerId: PlayerId) => {
    if (runtime === null) return;
    const generation = ++runtimeGeneration.current;
    runtimeRef.current = null;
    setRuntime(null);
    void runtime.battle.dispose().then(() => createAndInstallRuntime(generation, playerId));
  };

  const reset = () => replaceRuntime(selectedPlayerId);

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
        selectedPlayerId={selectedPlayerId}
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
          participantColorIds={DEMO_PARTICIPANT_COLOR_IDS}
          participantLabels={DEMO_PARTICIPANT_LABELS}
        />
      )}
    </GamePage>
  );
}
