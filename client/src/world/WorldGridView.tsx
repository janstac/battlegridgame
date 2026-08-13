import type { PlayerId, Position, WorldSnapshot } from "@grid-game/shared";
import type { CSSProperties } from "react";

import styles from "./WorldGridView.module.css";

const WORLD_COLOR_COUNT = 6;

export function worldPlayerColor(playerId: PlayerId): string {
  let hash = 0;
  for (const character of playerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `var(--world-player-color-${hash % WORLD_COLOR_COUNT})`;
}

export type WorldGridViewProps = Readonly<{
  snapshot: WorldSnapshot;
  localPlayerId: PlayerId;
  now: number;
  interactive?: boolean;
  selectedPosition?: Position | null;
  onCellActivate?(position: Position): void;
}>;

export function WorldGridView({
  snapshot,
  localPlayerId,
  now,
  interactive = false,
  selectedPosition = null,
  onCellActivate,
}: WorldGridViewProps) {
  const { width, height, cells } = snapshot.grid;
  return (
    <svg
      className={styles.grid}
      viewBox={`0 0 ${width} ${height}`}
      role="grid"
      aria-label={`World grid, ${width} by ${height}`}
    >
      <rect className={styles.backdrop} width={width} height={height} />
      {cells.map((cell, index) => {
        const position = { x: index % width, y: Math.floor(index / width) };
        const actionable = interactive && (
          (cell.kind === "occupied" && cell.playerId !== localPlayerId)
          || cell.kind === "challengePending"
        );
        const selected = selectedPosition?.x === position.x
          && selectedPosition.y === position.y;
        const className = [
          styles[cell.kind],
          actionable ? styles.actionable : undefined,
        ].filter(Boolean).join(" ");
        const style = cell.kind === "occupied"
          ? { "--world-player-color": worldPlayerColor(cell.playerId) } as CSSProperties
          : undefined;
        const label = cell.kind === "challengePending"
          ? `${Math.max(0, Math.ceil((cell.closesAt - now) / 1_000))}s`
          : cell.kind === "battle" ? "⚔" : cell.kind === "occupied" ? "●" : "";
        const description = cell.kind === "unoccupied"
          ? `Cell ${position.x + 1}, ${position.y + 1}, unoccupied`
          : cell.kind === "occupied"
            ? `Cell ${position.x + 1}, ${position.y + 1}, occupied by ${cell.playerId}`
            : cell.kind === "challengePending"
              ? `Cell ${position.x + 1}, ${position.y + 1}, challenge pending with ${cell.participantIds.length} players`
              : `Cell ${position.x + 1}, ${position.y + 1}, battle with ${cell.playerIds.length} players`;
        return (
          <g
            className={className}
            style={style}
            key={index}
            transform={`translate(${position.x} ${position.y})`}
            role="gridcell"
            aria-label={description}
            tabIndex={actionable ? 0 : undefined}
            onClick={interactive ? () => onCellActivate?.(position) : undefined}
            onKeyDown={actionable ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onCellActivate?.(position);
              }
            } : undefined}
          >
            <rect className={styles.cell} x="0.04" y="0.04" width="0.92" height="0.92" rx="0.1" />
            {selected && (
              <rect className={styles.selectionOutline} x="0.08" y="0.08" width="0.84" height="0.84" rx="0.08" />
            )}
            {cell.kind === "challengePending" && cell.participantIds.map((participantId, participantIndex) => (
              <circle
                key={participantId}
                cx={0.18 + participantIndex * 0.19}
                cy="0.2"
                r="0.075"
                fill={worldPlayerColor(participantId)}
              />
            ))}
            {label !== "" && <text className={styles.label} x="0.5" y="0.58">{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}
