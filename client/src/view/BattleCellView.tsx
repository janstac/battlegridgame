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
  localPlayerId: PlayerId;
  pendingDueTick?: number;
  disabled: boolean;
  onActivate(position: Position): void;
}>;

function cellLabel(
  cell: BattleCell,
  position: Position,
  pendingDueTick?: number,
): string {
  const location = `Column ${position.x + 1}, row ${position.y + 1}`;
  const pendingLabel =
    pendingDueTick === undefined
      ? ""
      : `, split due on tick ${pendingDueTick}`;
  switch (cell.kind) {
    case "empty":
      return `${location}: empty`;
    case "wall":
      return `${location}: wall`;
    case "occupied":
      return `${location}: ${cell.playerId}, count ${cell.count}${pendingLabel}`;
  }
}

/** Renders one battle cell as an accessible, whole-cell SVG control. */
export function BattleCellView({
  cell,
  position,
  players,
  localPlayerId,
  pendingDueTick,
  disabled,
  onActivate,
}: BattleCellViewProps) {
  const ownerColors =
    cell.kind === "occupied"
      ? colorsForPlayer(cell.playerId, players)
      : undefined;
  const ownedByLocalPlayer =
    cell.kind === "occupied" && cell.playerId === localPlayerId;
  // This only suppresses impossible UI intents. The authoritative session still
  // validates ownership because state can change between rendering and input.
  const canActivate = !disabled && ownedByLocalPlayer;
  const label = cellLabel(cell, position, pendingDueTick);

  const activate = () => {
    if (canActivate) {
      onActivate(position);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  const classNames = [
    "battle-cell",
    `battle-cell--${cell.kind}`,
    ownedByLocalPlayer ? "battle-cell--selected-owner" : "",
    canActivate ? "battle-cell--interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={classNames}
      transform={`translate(${position.x} ${position.y})`}
      role="gridcell"
      aria-label={label}
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
        <g aria-hidden="true">
          <circle className="battle-cell__pending" cx="0.78" cy="0.2" r="0.09" />
        </g>
      )}

      {canActivate && (
        <rect
          className="battle-cell__hit-target"
          x="0"
          y="0"
          width="1"
          height="1"
          role="button"
          tabIndex={0}
          aria-label={`Increment ${label}`}
          onClick={activate}
          onKeyDown={handleKeyDown}
        />
      )}
    </g>
  );
}
