import { useState } from "react";

import { LocalGame } from "./app/LocalGame.tsx";
import { NetworkGame } from "./app/NetworkGame.tsx";
import styles from "./App.module.css";
import { ActionButton } from "./ui/ActionButton.tsx";
import { GamePage } from "./ui/GamePage.tsx";

type AppMode = "local" | "network" | null;

/** Chooses between the local demonstration and a server-backed battle. */
export function App() {
  const [mode, setMode] = useState<AppMode>(null);

  if (mode === "local") {
    return <LocalGame onBack={() => setMode(null)} />;
  }
  if (mode === "network") {
    return <NetworkGame onBack={() => setMode(null)} />;
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
          onClick={() => setMode("local")}
        >
          Play locally
        </ActionButton>
        <ActionButton
          className={styles.modeAction}
          type="button"
          onClick={() => setMode("network")}
        >
          Play on the network
        </ActionButton>
      </section>
    </GamePage>
  );
}
