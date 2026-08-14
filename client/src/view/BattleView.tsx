import type { BattleParticipantId } from "@grid-game/shared";
import type { CSSProperties } from "react";

import type { ClientBattleState } from "../model/index.ts";
import {
  playerColorClassName,
  type PlayerColorId,
} from "./BattleCellView.tsx";
import { BattleGridView } from "./BattleGridView.tsx";
import styles from "./BattleView.module.css";
import { cooldownProgress } from "./cooldownProgress.ts";
import { useClientBattleState } from "./useClientBattleState.ts";

export type BattleViewProps = Readonly<{
  battle: ClientBattleState;
  participantColorIds: ReadonlyMap<BattleParticipantId, PlayerColorId>;
  participantLabels?: ReadonlyMap<BattleParticipantId, string>;
}>;

/** Renders directly from the client-owned authoritative state projection. */
export function BattleView({
  battle,
  participantColorIds,
  participantLabels,
}: BattleViewProps) {
  const state = useClientBattleState(battle);
  const snapshot = state.battle;
  const localCooldown = snapshot.cooldowns.find(
    (entry) => entry.participantId === state.localParticipantId,
  );
  const { remainingTicks: cooldownTicks } = cooldownProgress(
    localCooldown,
    state.estimatedTick,
  );
  const localPlayerOnCooldown = cooldownTicks > 0;
  const localParticipant = snapshot.participants.find(
    ({ participantId }) => participantId === state.localParticipantId,
  );
  const localInteractionDisabled = state.localCommandPending
    || localPlayerOnCooldown
    || localParticipant?.status !== "active";
  const winner = snapshot.status.kind === "finished"
    ? snapshot.status.winnerId
    : null;

  return (
    <section className={styles.panel}>
      <div className={styles.playerLegend}>
        {snapshot.participants.map(({ participantId, status }) => {
          const playerColorId = participantColorIds.get(participantId);
          if (playerColorId === undefined) {
            throw new Error(`Missing color ID for participant ${participantId}`);
          }
          const participantLabel = participantLabels?.get(participantId)
            ?? `Player ${participantId + 1}`;
          const { remainingTicks, ratio } = cooldownProgress(
            snapshot.cooldowns.find((entry) => entry.participantId === participantId),
            state.estimatedTick,
          );
          return (
            <span
              className={`${styles.player} ${playerColorClassName(playerColorId)} ${
                participantId === state.localParticipantId ? styles.activePlayer : ""
              }`}
              key={participantId}
            >
              {ratio > 0 ? (
                <span
                  className={styles.cooldownRing}
                  role="progressbar"
                  aria-label={`${participantLabel} action cooldown`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                  aria-valuetext={`${remainingTicks} ticks remaining`}
                  style={{ "--cooldown-progress": ratio } as CSSProperties}
                >
                  <span className={styles.swatch} aria-hidden="true" />
                </span>
              ) : (
                <>
                  <span className={styles.swatch} aria-hidden="true" />
                  <span className={styles.visuallyHidden}>Ready</span>
                </>
              )}
              {participantLabel}
              {status === "active" ? "" : ` (${status})`}
            </span>
          );
        })}
      </div>

      {snapshot.status.kind === "finished" && (
        <p className={styles.winner}>
          {winner === null
            ? "The battle ended without a winner."
            : `${participantLabels?.get(winner) ?? `Player ${winner + 1}`} wins the battle.`}
        </p>
      )}
      <BattleGridView
        snapshot={snapshot}
        localParticipantId={state.localParticipantId}
        localInteractionDisabled={localInteractionDisabled}
        participantColorIds={participantColorIds}
        onCellActivate={(position) => {
          void battle.increment(position);
        }}
      />
    </section>
  );
}
