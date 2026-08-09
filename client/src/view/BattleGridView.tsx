import type {
  BattleSnapshot,
  PlayerId,
  Position,
} from "@grid-game/shared";

import { BattleCellView } from "./BattleCellView.tsx";

/** Rendering inputs for the authoritative SVG battle grid. */
export type BattleGridViewProps = Readonly<{
  snapshot: BattleSnapshot;
  localPlayerId: PlayerId;
  localPlayerOnCooldown: boolean;
  onCellActivate(position: Position): void;
}>;

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/** Renders the current authoritative grid as a responsive SVG. */
export function BattleGridView({
  snapshot,
  localPlayerId,
  localPlayerOnCooldown,
  onCellActivate,
}: BattleGridViewProps) {
  const { width, height, cells } = snapshot.grid;
  const pendingByPosition = new Map(
    snapshot.pendingSplits.map((split) => [
      positionKey(split.position),
      split.dueTick,
    ]),
  );
  const rows = Array.from({ length: height }, (_, y) =>
    cells.slice(y * width, (y + 1) * width),
  );

  return (
    <svg
      className="battle-grid"
      viewBox={`0 0 ${width} ${height}`}
      role="grid"
      aria-label={`${width} by ${height} battle grid`}
      aria-rowcount={height}
      aria-colcount={width}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className="battle-grid__backdrop"
        width={width}
        height={height}
        role="presentation"
      />
      {rows.map((row, y) => (
        <g role="row" aria-rowindex={y + 1} key={y}>
          {row.map((cell, x) => {
            // Serialized grids are row-major; no game rule is inferred here.
            const position = { x, y };
            const key = positionKey(position);
            return (
              <BattleCellView
                key={key}
                cell={cell}
                position={position}
                players={snapshot.players}
                localPlayerId={localPlayerId}
                {...(pendingByPosition.has(key)
                  ? { pendingDueTick: pendingByPosition.get(key)! }
                  : {})}
                disabled={
                  snapshot.status.kind === "finished" || localPlayerOnCooldown
                }
                onActivate={onCellActivate}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}
