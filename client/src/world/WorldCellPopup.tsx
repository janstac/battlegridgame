import type { Position } from "@grid-game/shared";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

import styles from "./WorldCellPopup.module.css";

export type WorldCellPopupProps = Readonly<{
  position: Position;
  gridWidth: number;
  gridHeight: number;
  children: ReactNode;
}>;

/** Positions interactive HTML beside a logical cell inside transformed World content. */
export function WorldCellPopup({
  position,
  gridWidth,
  gridHeight,
  children,
}: WorldCellPopupProps) {
  const cellCenter = (position.x + 0.5) / gridWidth * 100;
  const placeBelow = position.y === 0;
  const cellEdge = (position.y + (placeBelow ? 1 : 0)) / gridHeight * 100;
  const style = {
    "--world-popup-left": `clamp(7.5rem, ${cellCenter}%, calc(100% - 7.5rem))`,
    "--world-popup-top": `${cellEdge}%`,
  } as CSSProperties;
  const stopViewportGesture = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className={`${styles.popup} ${placeBelow ? styles.below : styles.above}`}
      style={style}
      onPointerDown={stopViewportGesture}
    >
      {children}
    </div>
  );
}
