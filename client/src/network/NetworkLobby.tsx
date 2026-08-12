import type { PlayerId } from "@grid-game/shared";

import { ActionButton } from "../ui/ActionButton.tsx";
import { StatusNotice } from "../ui/StatusNotice.tsx";
import styles from "./NetworkLobby.module.css";

export type NetworkLobbyProps = Readonly<{
  playerIds: readonly PlayerId[];
  localPlayerId: PlayerId;
  selectedPlayerIds: ReadonlySet<PlayerId>;
  busy: boolean;
  error: string | null;
  onTogglePlayer(playerId: PlayerId): void;
  onRefresh(): void;
  onCreate(): void;
}>;

type PlayerOptionProps = Readonly<{
  playerId: PlayerId;
  selected: boolean;
  local: boolean;
  busy: boolean;
  onToggle(playerId: PlayerId): void;
}>;

function PlayerOption({
  playerId,
  selected,
  local,
  busy,
  onToggle,
}: PlayerOptionProps) {
  return (
    <label className={styles.player}>
      <input
        type="checkbox"
        checked={local || selected}
        disabled={local || busy}
        onChange={() => onToggle(playerId)}
      />
      <span className={styles.playerName}>{playerId}</span>
      {local && <span className={styles.localBadge}>You</span>}
    </label>
  );
}

/** Selects the participants for a network battle. */
export function NetworkLobby({
  playerIds,
  localPlayerId,
  selectedPlayerIds,
  busy,
  error,
  onTogglePlayer,
  onRefresh,
  onCreate,
}: NetworkLobbyProps) {
  const selectedCount = selectedPlayerIds.size;
  const canCreate = selectedCount >= 2 && selectedCount <= 4 && !busy;

  return (
    <section className={styles.panel} aria-labelledby="network-lobby-title">
      <div className={styles.header}>
        <div className={styles.headingGroup}>
          <p className={styles.eyebrow}>Network lobby</p>
          <h2 id="network-lobby-title">Choose your opponents</h2>
        </div>
        <p className={styles.identity}>
          Playing as <strong>{localPlayerId}</strong>
        </p>
      </div>

      <fieldset className={styles.players} disabled={busy}>
        <legend>Select 2–4 players</legend>
        {playerIds.length === 0 ? (
          <p className={styles.empty}>No players are available yet.</p>
        ) : (
          <div className={styles.playerList}>
            {playerIds.map((playerId) => (
              <PlayerOption
                key={playerId}
                playerId={playerId}
                selected={selectedPlayerIds.has(playerId)}
                local={playerId === localPlayerId}
                busy={busy}
                onToggle={onTogglePlayer}
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className={styles.actions}>
        <p className={styles.selectionCount} aria-live="polite">
          {selectedCount} of 4 players selected
        </p>
        <ActionButton
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={onRefresh}
        >
          Refresh players
        </ActionButton>
        <ActionButton
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
        >
          {busy ? "Creating battle…" : "Create battle"}
        </ActionButton>
      </div>

      {busy && (
        <StatusNotice kind="progress">Waiting for the server…</StatusNotice>
      )}
      {error !== null && <StatusNotice kind="error">{error}</StatusNotice>}
    </section>
  );
}
