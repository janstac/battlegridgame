import type {
  BattleCell,
  PlayerId,
  Position,
} from "@grid-game/shared";
import type { KeyboardEvent } from "react";

import { colorsForPlayer } from "./player-colors.ts";

/** Rendering inputs for one complete SVG cell hit area. */
export type BattleCellViewProps = Readonly<{
  cell: BattleCell;
  position: Position;
  players: readonly PlayerId[];
  selectedPlayerId: PlayerId;
  pendingDueTick?: number;
  disabled: boolean;
  onActivate(position: Position): void;
}>;

function cellLabel(cell: BattleCell, position: Position): string {
  const location = `Column ${position.x + 1}, row ${position.y + 1}`;
  switch (cell.kind) {
    case "empty":
      return `${location}: empty`;
    case "wall":
      return `${location}: wall`;
    case "occupied":
      return `${location}: ${cell.playerId}, count ${cell.count}`;
  }
}

/** Renders one battle cell as an accessible, whole-cell SVG control. */
export function BattleCellView({
  cell,
  position,
  players,
  selectedPlayerId,
  pendingDueTick,
  disabled,
  onActivate,
}: BattleCellViewProps) {
  const ownerColors =
    cell.kind === "occupied"
      ? colorsForPlayer(cell.playerId, players)
      : undefined;
  const canActivate = !disabled && cell.kind !== "wall";
  const ownedBySelected =
    cell.kind === "occupied" && cell.playerId === selectedPlayerId;

  const activate = () => {
    if (canActivate) {
      onActivate(position);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  const classNames = [
    "battle-cell",
    `battle-cell--${cell.kind}`,
    ownedBySelected ? "battle-cell--selected-owner" : "",
    canActivate ? "battle-cell--interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={classNames}
      transform={`translate(${position.x} ${position.y})`}
      role={canActivate ? "button" : "img"}
      tabIndex={canActivate ? 0 : undefined}
      aria-label={cellLabel(cell, position)}
      aria-disabled={!canActivate}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      <rect
        className="battle-cell__surface"
        x="0.035"
        y="0.035"
        width="0.93"
        height="0.93"
        rx="0.1"
        fill={ownerColors?.fill}
        stroke={ownerColors?.stroke}
      />

      {cell.kind === "wall" && (
        <path
          className="battle-cell__wall-mark"
          d="M .2 .28 H .8 M .2 .5 H .8 M .2 .72 H .8 M .34 .28 V .5 M .66 .5 V .72"
        />
      )}

      {cell.kind === "occupied" && (
        <text
          className="battle-cell__count"
          x="0.5"
          y="0.53"
          fill={ownerColors?.text}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {cell.count}
        </text>
      )}

      {pendingDueTick !== undefined && (
        <g aria-label={`Split due on tick ${pendingDueTick}`}>
          <circle className="battle-cell__pending" cx="0.78" cy="0.2" r="0.09" />
          <title>Split due on tick {pendingDueTick}</title>
        </g>
      )}
    </g>
  );
}
