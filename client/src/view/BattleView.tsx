import type { ClientBattleState } from "../model/index.ts";
import { BattleGridView } from "./BattleGridView.tsx";
import { colorsForPlayer } from "./player-colors.ts";
import { useClientBattleState } from "./useClientBattleState.ts";

export type BattleViewProps = Readonly<{
  battle: ClientBattleState;
}>;

const REJECTION_LABELS = {
  battleFinished: "The battle is already finished.",
  unknownPlayer: "That player is not part of this battle.",
  outOfBounds: "That cell is outside the battle grid.",
  notOccupied: "Choose a cell that already belongs to the active player.",
  notOwner: "That cell belongs to another player.",
  cooldownActive: "That player is still cooling down.",
} as const;

/** Renders directly from the client-owned authoritative state projection. */
export function BattleView({ battle }: BattleViewProps) {
  const state = useClientBattleState(battle);
  const snapshot = state.battle;
  const cooldown = snapshot.cooldowns.find(
    (entry) => entry.playerId === state.localPlayerId,
  );
  const cooldownTicks = Math.max(
    0,
    (cooldown?.nextActionTick ?? 0) - state.estimatedTick,
  );
  const localPlayerOnCooldown = cooldownTicks > 0;
  const winner = snapshot.status.kind === "finished"
    ? snapshot.status.winnerId
    : null;

  return (
    <section className="battle-panel" aria-label="Battle">
      <div className="battle-summary">
        <span>Tick <strong>{state.estimatedTick}</strong></span>
        <span>
          Pending splits <strong>{snapshot.pendingSplits.length}</strong>
        </span>
        <span>
          Cooldown <strong>{
            cooldownTicks === 0 ? "ready" : `${cooldownTicks} ticks`
          }</strong>
        </span>
      </div>

      <div className="player-legend" aria-label="Players">
        {snapshot.players.map((playerId) => {
          const colors = colorsForPlayer(playerId, snapshot.players);
          return (
            <span
              className={
                playerId === state.localPlayerId
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
        localPlayerId={state.localPlayerId}
        localPlayerOnCooldown={localPlayerOnCooldown}
        onCellActivate={(position) => {
          void battle.increment(position);
        }}
      />
      <p className="battle-help">
        Select a player, then activate one of their numbered cells. A dot marks
        a cell with a delayed split queued.
      </p>
    </section>
  );
}
