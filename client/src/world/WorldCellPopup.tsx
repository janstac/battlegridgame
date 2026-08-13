import type { Position } from "@grid-game/shared";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

import { projectLogicalPoint } from "./viewportMath.ts";
import styles from "./WorldCellPopup.module.css";
import { useWorldViewportProjection } from "./WorldViewport.tsx";

export type WorldCellPopupProps = Readonly<{
  position: Position;
  gridWidth: number;
  gridHeight: number;
  children: ReactNode;
}>;

/** Positions interactive HTML beside a logical cell in the SVG World projection. */
export function WorldCellPopup({
  position,
  gridWidth,
  gridHeight,
  children,
}: WorldCellPopupProps) {
  const projection = useWorldViewportProjection();
  const cellCenter = (position.x + 0.5) / gridWidth * 100;
  const placeBelow = position.y === 0;
  const cellEdge = (position.y + (placeBelow ? 1 : 0)) / gridHeight * 100;
  const projected = projection === null ? null : projectLogicalPoint(
    { x: position.x + 0.5, y: position.y + (placeBelow ? 1 : 0) },
    projection.transform,
    { width: gridWidth, height: gridHeight },
    projection.contentSize,
  );
  const style = {
    "--world-popup-left": projected === null
      ? `clamp(7.5rem, ${cellCenter}%, calc(100% - 7.5rem))`
      : `clamp(7.5rem, ${projected.x}px, calc(100% - 7.5rem))`,
    "--world-popup-top": projected === null ? `${cellEdge}%` : `${projected.y}px`,
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
