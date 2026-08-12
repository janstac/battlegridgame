import type { KeyboardEvent } from "react";

import {
  PENDING_SYMBOL_ID,
  WALL_SYMBOL_ID,
} from "./BattleSvgDefinitions.tsx";
import styles from "./BattleCellView.module.css";

/** Fixed presentation colors available to battle participants. */
export const PLAYER_COLORS = [
  { fill: "#2f6fd6", stroke: "#a9c7ff", text: "#ffffff" },
  { fill: "#d4485f", stroke: "#ffc0ca", text: "#ffffff" },
  { fill: "#d29d22", stroke: "#684600", text: "#000000" },
  { fill: "#238b68", stroke: "#9be6ca", text: "#ffffff" },
] as const;

/** Index into the fixed player color palette. */
export type PlayerColorId = 0 | 1 | 2 | 3;

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
  const colors = PLAYER_COLORS[playerColorId];
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
        canActivate ? styles.interactive : "",
      ].filter(Boolean).join(" ")}
    >
      <CellSurface
        fill={colors.fill}
        stroke={colors.stroke}
        canActivate={canActivate}
        onActivate={onActivate}
        onKeyDown={handleKeyDown}
      />
      <text
        className={styles.count}
        x="0.5"
        y="0.53"
        fill={colors.text}
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
  fill?: string;
  stroke?: string;
  canActivate?: boolean;
  onActivate?: () => void;
  onKeyDown?: (event: KeyboardEvent<SVGRectElement>) => void;
}>;

function CellSurface({
  fill,
  stroke,
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
      {...(fill === undefined ? {} : { fill })}
      {...(stroke === undefined ? {} : { stroke })}
      tabIndex={canActivate ? 0 : undefined}
      onClick={canActivate ? onActivate : undefined}
      onKeyDown={canActivate ? onKeyDown : undefined}
    />
  );
}
