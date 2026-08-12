import type { BattleId, BattleParticipantId, Position } from "@grid-game/shared";

import type { ClientBattleState } from "../model/index.ts";
import { BattleView, type PlayerColorId } from "../view/index.ts";
import styles from "./BattleWorkspace.module.css";

export type BattleTileModel = Readonly<{
  battleId: BattleId;
  battle: ClientBattleState;
  worldPosition: Position | null;
  participantColorIds: ReadonlyMap<BattleParticipantId, PlayerColorId>;
  participantLabels: ReadonlyMap<BattleParticipantId, string>;
}>;

export function BattleTile({
  model,
  index,
  count,
  onMove,
  onLeave,
}: Readonly<{
  model: BattleTileModel;
  index: number;
  count: number;
  onMove(direction: -1 | 1): void;
  onLeave(): void;
}>) {
  return (
    <article className={styles.tile}>
      <header className={styles.tileHeader}>
        <div>
          <strong>Battle {model.battleId}</strong>
          {model.worldPosition !== null && (
            <span>World {model.worldPosition.x + 1}, {model.worldPosition.y + 1}</span>
          )}
        </div>
        <div className={styles.tileActions}>
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move battle ${model.battleId} earlier`}>←</button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move battle ${model.battleId} later`}>→</button>
          <button type="button" className={styles.leave} onClick={onLeave}>Leave</button>
        </div>
      </header>
      <BattleView
        battle={model.battle}
        participantColorIds={model.participantColorIds}
        participantLabels={model.participantLabels}
      />
    </article>
  );
}
