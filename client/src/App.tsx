import { useState } from "react";

import { LocalGame } from "./app/LocalGame.tsx";
import { NetworkGame } from "./app/NetworkGame.tsx";
import styles from "./App.module.css";
import { ActionButton } from "./ui/ActionButton.tsx";
import { GamePage } from "./ui/GamePage.tsx";
import { clearResumeSession } from "./session/ResumeTokenStore.ts";
import { initialAppMode, type AppMode } from "./app/initialAppMode.ts";

/** Chooses between the local demonstration and a server-backed battle. */
export function App() {
  const [mode, setMode] = useState<AppMode>(initialAppMode);

  if (mode?.kind === "local") {
    return <LocalGame onBack={() => setMode(null)} />;
  }
  if (mode?.kind === "network") {
    return <NetworkGame
      resumeOnly={mode.resumeOnly}
      onResumeRejected={() => {
        clearResumeSession();
        setMode(null);
      }}
    />;
  }

  return (
    <GamePage
      eyebrow="Choose a game"
      title="Grid Battle"
      description={
        <>
          Run a battle entirely in this browser, or connect to the game server
          and invite other connected players.
        </>
      }
    >
      <section className={styles.modeSelection} aria-label="Game mode">
        <ActionButton
          className={styles.modeAction}
          type="button"
          onClick={() => setMode({ kind: "local" })}
        >
          Play locally
        </ActionButton>
        <ActionButton
          className={styles.modeAction}
          type="button"
          onClick={() => setMode({ kind: "network", resumeOnly: false })}
        >
          Play on the network
        </ActionButton>
      </section>
    </GamePage>
  );
}
