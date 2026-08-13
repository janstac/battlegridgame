import type { KeyboardEvent } from "react";

import {
  PENDING_SYMBOL_ID,
  WALL_SYMBOL_ID,
} from "./BattleSvgDefinitions.tsx";
import styles from "./BattleCellView.module.css";

/** Index into the fixed player color palette. */
export type PlayerColorId = 0 | 1 | 2 | 3;

/** Returns the CSS class that supplies the participant's single identity color. */
export function playerColorClassName(playerColorId: PlayerColorId): string {
  const className = styles[`player${playerColorId}`];
  if (className === undefined) throw new Error(`Missing player color class ${playerColorId}`);
  return className;
}

/** Renders an empty cell in local 0..1 SVG coordinates. */
export function EmptyCellView() {
  return (
    <g className={`${styles.cell} ${styles.empty}`}>
      <CellSurface />
    </g>
  );
}

/** Renders a wall cell using geometry shared at the application root. */
export function WallCellView() {
  return (
    <g className={`${styles.cell} ${styles.wall}`}>
      <CellSurface />
      <use
        className={styles.wallMark}
        href={`#${WALL_SYMBOL_ID}`}
        width="1"
        height="1"
      />
    </g>
  );
}

export type OccupiedCellViewProps = Readonly<{
  count: number;
  playerColorId: PlayerColorId;
  canActivate: boolean;
  hasPendingSplit: boolean;
  onActivate(): void;
}>;

/** Renders an occupied cell in local coordinates with no player identity data. */
export function OccupiedCellView({
  count,
  playerColorId,
  canActivate,
  hasPendingSplit,
  onActivate,
}: OccupiedCellViewProps) {
  const handleKeyDown = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <g
      className={[
        styles.cell,
        playerColorClassName(playerColorId),
        canActivate ? styles.interactive : "",
      ].filter(Boolean).join(" ")}
    >
      <CellSurface
        canActivate={canActivate}
        onActivate={onActivate}
        onKeyDown={handleKeyDown}
      />
      <text
        className={styles.count}
        x="0.5"
        y="0.53"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {count}
      </text>
      {hasPendingSplit && (
        <use
          className={styles.pending}
          href={`#${PENDING_SYMBOL_ID}`}
          width="1"
          height="1"
        />
      )}
    </g>
  );
}

type CellSurfaceProps = Readonly<{
  canActivate?: boolean;
  onActivate?: () => void;
  onKeyDown?: (event: KeyboardEvent<SVGRectElement>) => void;
}>;

function CellSurface({
  canActivate = false,
  onActivate,
  onKeyDown,
}: CellSurfaceProps) {
  return (
    <rect
      className={styles.surface}
      x="0.035"
      y="0.035"
      width="0.93"
      height="0.93"
      rx="0.1"
      tabIndex={canActivate ? 0 : undefined}
      onClick={canActivate ? onActivate : undefined}
      onKeyDown={canActivate ? onKeyDown : undefined}
    />
  );
}
