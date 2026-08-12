import type { PlayerId } from "@grid-game/shared";

import { ActionButton } from "../ui/ActionButton.tsx";
import styles from "./DemoControls.module.css";

/** Inputs for local-only player and reset controls. */
export type DemoControlsProps = Readonly<{
  players: readonly PlayerId[];
  selectedPlayerId: PlayerId;
  onSelectPlayer(playerId: PlayerId): void;
  onReset(): void;
}>;

/** Renders controls that stand in for identity and match creation in the demo. */
export function DemoControls({
  players,
  selectedPlayerId,
  onSelectPlayer,
  onReset,
}: DemoControlsProps) {
  return (
    <section className={styles.controls}>
      <label className={styles.label} htmlFor="active-player">
        Act as
      </label>
      <select
        className={styles.select}
        id="active-player"
        value={selectedPlayerId}
        onChange={(event) => onSelectPlayer(event.target.value)}
      >
        {players.map((playerId) => (
          <option key={playerId} value={playerId}>
            {playerId}
          </option>
        ))}
      </select>
      <ActionButton
        className={styles.reset}
        variant="secondary"
        type="button"
        onClick={onReset}
      >
        Reset battle
      </ActionButton>
    </section>
  );
}
