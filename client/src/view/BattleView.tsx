import type { BattleParticipantId } from "@grid-game/shared";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { ClientBattleState } from "../model/index.ts";
import {
  playerColorClassName,
  type PlayerColorId,
} from "./BattleCellView.tsx";
import { BattleGridView } from "./BattleGridView.tsx";
import styles from "./BattleView.module.css";
import { handleConfirmationKeyDown } from "./confirmationFocus.ts";
import { cooldownProgress } from "./cooldownProgress.ts";
import { useClientBattleState } from "./useClientBattleState.ts";

export type BattleViewProps = Readonly<{
  battle: ClientBattleState;
  participantColorIds: ReadonlyMap<BattleParticipantId, PlayerColorId>;
  participantLabels?: ReadonlyMap<BattleParticipantId, string>;
  controls?: Readonly<{
    battleLabel: string;
    showMoveButtons: boolean;
    canMoveEarlier: boolean;
    canMoveLater: boolean;
    onMove(direction: -1 | 1): void;
    onLeave(): void;
  }>;
}>;

/** Renders directly from the client-owned authoritative state projection. */
export function BattleView({
  battle,
  participantColorIds,
  participantLabels,
  controls,
}: BattleViewProps) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const leaveButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null);
  const closingConfirmationRef = useRef(false);
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

  const closeConfirmation = () => {
    closingConfirmationRef.current = true;
    setConfirmingLeave(false);
    leaveButtonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!confirmingLeave) {
      closingConfirmationRef.current = false;
      return;
    }

    cancelConfirmationRef.current?.focus();
    const keepFocusInDialog = (event: FocusEvent) => {
      const dialog = confirmationDialogRef.current;
      if (
        closingConfirmationRef.current
        || dialog === null
        || dialog.contains(event.target as Node | null)
      ) return;
      cancelConfirmationRef.current?.focus();
    };
    document.addEventListener("focusin", keepFocusInDialog);
    return () => document.removeEventListener("focusin", keepFocusInDialog);
  }, [confirmingLeave]);

  return (
    <section className={styles.panel}>
      {controls !== undefined && (
        <div className={styles.controls}>
          {controls.showMoveButtons && (
            <>
              <button
                type="button"
                disabled={!controls.canMoveEarlier}
                onClick={() => controls.onMove(-1)}
                aria-label={`Move ${controls.battleLabel} earlier`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={!controls.canMoveLater}
                onClick={() => controls.onMove(1)}
                aria-label={`Move ${controls.battleLabel} later`}
              >
                ↓
              </button>
            </>
          )}
          <button
            ref={leaveButtonRef}
            type="button"
            className={styles.leave}
            onClick={() => {
              closingConfirmationRef.current = false;
              setConfirmingLeave(true);
            }}
            aria-label={`Leave ${controls.battleLabel}`}
          >
            ×
          </button>
        </div>
      )}

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
          const isCooling = ratio > 0;
          return (
            <span
              className={`${styles.player} ${playerColorClassName(playerColorId)} ${
                participantId === state.localParticipantId ? styles.activePlayer : ""
              }`}
              key={participantId}
            >
              <span className={styles.cooldownSlot}>
                <span
                  className={`${styles.cooldownRing} ${
                    isCooling ? styles.cooling : ""
                  }`}
                  role={isCooling ? "progressbar" : undefined}
                  aria-label={isCooling
                    ? `${participantLabel} action cooldown`
                    : undefined}
                  aria-valuemin={isCooling ? 0 : undefined}
                  aria-valuemax={isCooling ? 100 : undefined}
                  aria-valuenow={isCooling ? Math.round(ratio * 100) : undefined}
                  aria-valuetext={isCooling
                    ? `${remainingTicks} ticks remaining`
                    : undefined}
                  style={{ "--cooldown-progress": ratio } as CSSProperties}
                >
                  <span className={styles.swatch} aria-hidden="true" />
                </span>
                {!isCooling && (
                  <span className={styles.visuallyHidden}>Ready</span>
                )}
              </span>
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
      <div className={styles.gridArea}>
        <BattleGridView
          snapshot={snapshot}
          localParticipantId={state.localParticipantId}
          localInteractionDisabled={localInteractionDisabled}
          participantColorIds={participantColorIds}
          onCellActivate={(position) => {
            void battle.increment(position);
          }}
        />
      </div>
      {controls !== undefined && confirmingLeave && (
        <div className={styles.confirmationLayer}>
          <div
            ref={confirmationDialogRef}
            className={styles.confirmationDialog}
            role="dialog"
            aria-labelledby={confirmationTitleId}
            aria-describedby={confirmationDescriptionId}
            tabIndex={-1}
            onKeyDown={(event) => handleConfirmationKeyDown(
              event.nativeEvent,
              event.currentTarget,
              document.activeElement,
              closeConfirmation,
            )}
          >
            <p id={confirmationTitleId}>Leave this battle?</p>
            <p id={confirmationDescriptionId} className={styles.confirmationDescription}>
              Your place in this battle will be released.
            </p>
            <div className={styles.confirmationActions}>
              <button
                type="button"
                onClick={() => {
                  closeConfirmation();
                  controls.onLeave();
                }}
              >
                Yes
              </button>
              <button ref={cancelConfirmationRef} type="button" onClick={closeConfirmation}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
