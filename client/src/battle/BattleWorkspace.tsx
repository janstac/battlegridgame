import type { BattleId } from "@grid-game/shared";

import { BattleTile, type BattleTileModel } from "./BattleTile.tsx";
import styles from "./BattleWorkspace.module.css";

export function BattleWorkspace({
  battles,
  order,
  onMove,
  onLeave,
}: Readonly<{
  battles: ReadonlyMap<BattleId, BattleTileModel>;
  order: readonly BattleId[];
  onMove(battleId: BattleId, direction: -1 | 1): void;
  onLeave(battleId: BattleId): void;
}>) {
  const visible = order.flatMap((battleId) => {
    const battle = battles.get(battleId);
    return battle === undefined ? [] : [battle];
  });
  if (visible.length === 0) {
    return <p className={styles.empty}>You are not participating in any active battles.</p>;
  }
  return (
    <section className={styles.workspace} aria-label="Your active battles">
      {visible.map((battle, index) => (
        <BattleTile
          key={battle.battleId}
          model={battle}
          index={index}
          count={visible.length}
          onMove={(direction) => onMove(battle.battleId, direction)}
          onLeave={() => onLeave(battle.battleId)}
        />
      ))}
    </section>
  );
}
