import type { PlayerId, Position } from "@grid-game/shared";

import type { BattleModel } from "../model/index.ts";
import { BattleGridView } from "./BattleGridView.tsx";
import { colorsForPlayer } from "./player-colors.ts";
import { useBattleModel } from "./useBattleModel.ts";

/** Inputs connecting the model and controller intent to the battle view. */
export type BattleViewProps = Readonly<{
  model: BattleModel;
  selectedPlayerId: PlayerId;
  onCellActivate(position: Position): void;
}>;

const REJECTION_LABELS = {
  battleFinished: "The battle is already finished.",
  unknownPlayer: "That player is not part of this battle.",
  outOfBounds: "That cell is outside the battle grid.",
  notOccupied: "Choose a cell that already belongs to the active player.",
  notOwner: "That cell belongs to another player.",
  cooldownActive: "That player is still cooling down.",
} as const;

/** Renders battle status, player legend, feedback, and the SVG grid. */
export function BattleView({
  model,
  selectedPlayerId,
  onCellActivate,
}: BattleViewProps) {
  const state = useBattleModel(model);
  const snapshot = state.snapshot;

  if (snapshot === null) {
    return <p className="loading-status">Starting local battle…</p>;
  }

  const cooldown = snapshot.cooldowns.find(
    (entry) => entry.playerId === selectedPlayerId,
  );
  const cooldownTicks = Math.max(
    0,
    (cooldown?.nextActionTick ?? 0) - snapshot.tick,
  );
  const winner =
    snapshot.status.kind === "finished" ? snapshot.status.winnerId : null;

  return (
    <section className="battle-panel" aria-label="Battle">
      <div className="battle-summary">
        <span>Tick <strong>{snapshot.tick}</strong></span>
        <span>Revision <strong>{snapshot.revision}</strong></span>
        <span>
          Pending splits <strong>{snapshot.pendingSplits.length}</strong>
        </span>
        <span>
          Cooldown <strong>{cooldownTicks === 0 ? "ready" : `${cooldownTicks} ticks`}</strong>
        </span>
      </div>

      <div className="player-legend" aria-label="Players">
        {snapshot.players.map((playerId) => {
          const colors = colorsForPlayer(playerId, snapshot.players);
          return (
            <span
              className={
                playerId === selectedPlayerId
                  ? "player-legend__item player-legend__item--active"
                  : "player-legend__item"
              }
              key={playerId}
            >
              <span
                className="player-legend__swatch"
                style={{ backgroundColor: colors.fill }}
                aria-hidden="true"
              />
              {playerId}
            </span>
          );
        })}
      </div>

      {winner !== null && (
        <p className="winner-banner" role="status">
          {winner} wins the battle.
        </p>
      )}
      {state.lastRejection !== null && (
        <p className="rejection-banner" role="alert">
          {REJECTION_LABELS[state.lastRejection.reason]}
        </p>
      )}

      <BattleGridView
        snapshot={snapshot}
        selectedPlayerId={selectedPlayerId}
        onCellActivate={onCellActivate}
      />
      <p className="battle-help">
        Select a player, then activate one of their numbered cells. A dot marks
        a cell with a delayed split queued.
      </p>
    </section>
  );
}
