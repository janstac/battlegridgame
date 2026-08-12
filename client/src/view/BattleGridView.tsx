import type {
  BattleCell,
  BattleSnapshot,
  PlayerId,
  Position,
} from "@grid-game/shared";

import {
  EmptyCellView,
  OccupiedCellView,
  type PlayerColorId,
  WallCellView,
} from "./BattleCellView.tsx";
import styles from "./BattleGridView.module.css";

/** Rendering inputs for the authoritative SVG battle grid. */
export type BattleGridViewProps = Readonly<{
  snapshot: BattleSnapshot;
  localPlayerId: PlayerId;
  localPlayerOnCooldown: boolean;
  playerColorIds: ReadonlyMap<PlayerId, PlayerColorId>;
  onCellActivate(position: Position): void;
}>;

/** Renders the current authoritative grid as a responsive SVG. */
export function BattleGridView({
  snapshot,
  localPlayerId,
  localPlayerOnCooldown,
  playerColorIds,
  onCellActivate,
}: BattleGridViewProps) {
  const { width, height, cells } = snapshot.grid;
  const pendingIndexes = new Set(
    snapshot.pendingSplits.map(
      ({ position }) => position.y * width + position.x,
    ),
  );
  const interactionDisabled =
    snapshot.status.kind === "finished" || localPlayerOnCooldown;

  return (
    <svg
      className={styles.grid}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className={styles.backdrop}
        width={width}
        height={height}
      />
      {cells.map((cell, index) => {
        const position = {
          x: index % width,
          y: Math.floor(index / width),
        };
        const canActivate =
          !interactionDisabled &&
          cell.kind === "occupied" &&
          cell.playerId === localPlayerId;
        return (
          <g
            className={styles.cellPosition}
            key={index}
            transform={`translate(${position.x} ${position.y})`}
          >
            {renderCell(cell, {
              canActivate,
              hasPendingSplit: pendingIndexes.has(index),
              onActivate: () => onCellActivate(position),
              playerColorIds,
            })}
          </g>
        );
      })}
    </svg>
  );
}

type CellRenderContext = Readonly<{
  canActivate: boolean;
  hasPendingSplit: boolean;
  onActivate(): void;
  playerColorIds: ReadonlyMap<PlayerId, PlayerColorId>;
}>;

function renderCell(cell: BattleCell, context: CellRenderContext) {
  switch (cell.kind) {
    case "empty":
      return <EmptyCellView />;
    case "wall":
      return <WallCellView />;
    case "occupied": {
      const playerColorId = context.playerColorIds.get(cell.playerId);
      if (playerColorId === undefined) {
        throw new Error(`Missing color ID for player ${cell.playerId}`);
      }
      return (
        <OccupiedCellView
          count={cell.count}
          playerColorId={playerColorId}
          canActivate={context.canActivate}
          hasPendingSplit={context.hasPendingSplit}
          onActivate={context.onActivate}
        />
      );
    }
  }
}
