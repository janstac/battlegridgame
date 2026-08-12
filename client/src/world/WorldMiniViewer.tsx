import type { PlayerId, WorldSnapshot } from "@grid-game/shared";

import { WorldGridView } from "./WorldGridView.tsx";
import styles from "./WorldMiniViewer.module.css";

export function WorldMiniViewer({
  snapshot,
  localPlayerId,
  now,
  onOpen,
}: Readonly<{
  snapshot: WorldSnapshot;
  localPlayerId: PlayerId;
  now: number;
  onOpen(): void;
}>) {
  return (
    <button className={styles.viewer} type="button" onClick={onOpen} aria-label="Open full World map">
      <span className={styles.label}>World overview</span>
      <span className={styles.map} aria-hidden="true">
        <WorldGridView snapshot={snapshot} localPlayerId={localPlayerId} now={now} />
      </span>
    </button>
  );
}
