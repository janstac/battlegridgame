import type {
  BattleSnapshot,
  PlayerId,
  Position,
} from "@grid-game/shared";

import { BattleCellView } from "./BattleCellView.tsx";

/** Rendering inputs for the authoritative SVG battle grid. */
export type BattleGridViewProps = Readonly<{
  snapshot: BattleSnapshot;
  selectedPlayerId: PlayerId;
  onCellActivate(position: Position): void;
}>;

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/** Renders the current authoritative grid as a responsive SVG. */
export function BattleGridView({
  snapshot,
  selectedPlayerId,
  onCellActivate,
}: BattleGridViewProps) {
  const { width, height, cells } = snapshot.grid;
  const pendingByPosition = new Map(
    snapshot.pendingSplits.map((split) => [
      positionKey(split.position),
      split.dueTick,
    ]),
  );

  return (
    <svg
      className="battle-grid"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`${width} by ${height} battle grid`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect className="battle-grid__backdrop" width={width} height={height} />
      {cells.map((cell, index) => {
        // Serialized grids are row-major; no game rule is inferred here.
        const position = {
          x: index % width,
          y: Math.floor(index / width),
        };
        return (
          <BattleCellView
            key={positionKey(position)}
            cell={cell}
            position={position}
            players={snapshot.players}
            selectedPlayerId={selectedPlayerId}
            {...(pendingByPosition.has(positionKey(position))
              ? {
                  pendingDueTick: pendingByPosition.get(positionKey(position))!,
                }
              : {})}
            disabled={snapshot.status.kind === "finished"}
            onActivate={onCellActivate}
          />
        );
      })}
    </svg>
  );
}
