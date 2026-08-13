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
  const cooldown = snapshot.cooldowns.find(
    (entry) => entry.participantId === state.localParticipantId,
  );
  const { remainingTicks: cooldownTicks, ratio: cooldownRatio } = cooldownProgress(
    cooldown,
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
      <div
        className={`${styles.cooldown} ${localPlayerOnCooldown ? "" : styles.cooldownReady}`}
        role="progressbar"
        aria-label="Action cooldown"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cooldownRatio * 100)}
        aria-valuetext={localPlayerOnCooldown ? `${cooldownTicks} ticks remaining` : "Ready"}
        style={{ "--cooldown-progress": cooldownRatio } as CSSProperties}
      >
        <span className={styles.cooldownFill} />
      </div>

      <div className={styles.playerLegend}>
        {snapshot.participants.map(({ participantId, status }) => {
          const playerColorId = participantColorIds.get(participantId);
          if (playerColorId === undefined) {
            throw new Error(`Missing color ID for participant ${participantId}`);
          }
          return (
            <span
              className={`${styles.player} ${playerColorClassName(playerColorId)} ${
                participantId === state.localParticipantId ? styles.activePlayer : ""
              }`}
              key={participantId}
            >
              <span className={styles.swatch} aria-hidden="true" />
              {participantLabels?.get(participantId) ?? `Player ${participantId + 1}`}
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
