import type { PlayerId } from "@grid-game/shared";

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
    <section className="demo-controls" aria-label="Demo controls">
      <label htmlFor="active-player">Act as</label>
      <select
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
      <button type="button" onClick={onReset}>
        Reset battle
      </button>
    </section>
  );
}
