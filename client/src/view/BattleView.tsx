import type { PlayerId } from "@grid-game/shared";

import type { ClientBattleState } from "../model/index.ts";
import {
  PLAYER_COLORS,
  type PlayerColorId,
} from "./BattleCellView.tsx";
import { BattleGridView } from "./BattleGridView.tsx";
import styles from "./BattleView.module.css";
import { useClientBattleState } from "./useClientBattleState.ts";

export type BattleViewProps = Readonly<{
  battle: ClientBattleState;
  playerColorIds: ReadonlyMap<PlayerId, PlayerColorId>;
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
export function BattleView({ battle, playerColorIds }: BattleViewProps) {
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
    <section className={styles.panel}>
      <div className={styles.summary}>
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

      <div className={styles.playerLegend}>
        {snapshot.players.map((playerId) => {
          const playerColorId = playerColorIds.get(playerId);
          if (playerColorId === undefined) {
            throw new Error(`Missing color ID for player ${playerId}`);
          }
          const colors = PLAYER_COLORS[playerColorId];
          return (
            <span
              className={`${styles.player} ${
                playerId === state.localPlayerId ? styles.activePlayer : ""
              }`}
              key={playerId}
            >
              <span
                className={styles.swatch}
                style={{ backgroundColor: colors.fill }}
              />
              {playerId}
            </span>
          );
        })}
      </div>

      {winner !== null && (
        <p className={styles.winner}>
          {winner} wins the battle.
        </p>
      )}
      {state.lastRejection !== null && (
        <p className={styles.rejection} role="alert">
          {REJECTION_LABELS[state.lastRejection.reason]}
        </p>
      )}

      <BattleGridView
        snapshot={snapshot}
        localPlayerId={state.localPlayerId}
        localPlayerOnCooldown={localPlayerOnCooldown}
        playerColorIds={playerColorIds}
        onCellActivate={(position) => {
          void battle.increment(position);
        }}
      />
      <p className={styles.help}>
        Activate one of your numbered cells. A dot marks a cell with a delayed
        split queued.
      </p>
    </section>
  );
}
