import type {
  BattleCell,
  BattleParticipantId,
  BattleSnapshot,
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
  localParticipantId: BattleParticipantId;
  localInteractionDisabled: boolean;
  participantColorIds: ReadonlyMap<BattleParticipantId, PlayerColorId>;
  onCellActivate(position: Position): void;
}>;

/** Renders the current authoritative grid as a responsive SVG. */
export function BattleGridView({
  snapshot,
  localParticipantId,
  localInteractionDisabled,
  participantColorIds,
  onCellActivate,
}: BattleGridViewProps) {
  const { width, height, cells } = snapshot.grid;
  const pendingIndexes = new Set(
    snapshot.pendingSplits.map(
      ({ position }) => position.y * width + position.x,
    ),
  );
  const interactionDisabled =
    snapshot.status.kind === "finished" || localInteractionDisabled;

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
          cell.participantId === localParticipantId;
        return (
          <g
            className={styles.cellPosition}
            key={index}
            transform={`translate(${position.x} ${position.y})`}
          >
            {renderCell(cell, {
              canActivate,
              hasPendingSplit: pendingIndexes.has(index),
              localParticipantId,
              onActivate: () => onCellActivate(position),
              participantColorIds,
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
  localParticipantId: BattleParticipantId;
  onActivate(): void;
  participantColorIds: ReadonlyMap<BattleParticipantId, PlayerColorId>;
}>;

function renderCell(cell: BattleCell, context: CellRenderContext) {
  switch (cell.kind) {
    case "empty":
      return <EmptyCellView />;
    case "wall":
      return <WallCellView />;
    case "occupied": {
      const playerColorId = context.participantColorIds.get(cell.participantId);
      if (playerColorId === undefined) {
        throw new Error(`Missing color ID for participant ${cell.participantId}`);
      }
      return (
        <OccupiedCellView
          count={cell.count}
          playerColorId={playerColorId}
          canActivate={context.canActivate}
          hasPendingSplit={context.hasPendingSplit}
          isLocallyOwned={cell.participantId === context.localParticipantId}
          onActivate={context.onActivate}
        />
      );
    }
  }
}
