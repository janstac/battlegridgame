import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  centroid,
  clampTransform,
  distance,
  exceedsDragThreshold,
  panTransform,
  zoomTransform,
  type ViewportPoint,
  type ViewportSize,
  type ViewportTransform,
} from "./viewportMath.ts";
import styles from "./WorldViewport.module.css";

export const WORLD_CONTENT_SIZE = { width: 640, height: 640 } as const;
const DRAG_THRESHOLD = 6;

export type WorldViewportProjection = Readonly<{
  transform: ViewportTransform;
  viewportSize: ViewportSize;
  contentSize: ViewportSize;
}>;

const WorldViewportContext = createContext<WorldViewportProjection | null>(null);

export function useWorldViewportProjection(): WorldViewportProjection | null {
  return useContext(WorldViewportContext);
}

export type WorldViewportProps = Readonly<{ children: ReactNode }>;

export function WorldViewport({ children }: WorldViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, ViewportPoint>());
  const gestureRef = useRef<{ centroid: ViewportPoint; distance: number | null } | null>(null);
  const gestureStartRef = useRef<ViewportPoint | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const [size, setSize] = useState<ViewportSize>({ width: 640, height: 640 });
  const [transform, setTransform] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const update = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setTransform((current) => clampTransform(current, size, WORLD_CONTENT_SIZE));
  }, [size]);

  const pointerPoint = (event: ReactPointerEvent): ViewportPoint => {
    const bounds = hostRef.current?.getBoundingClientRect();
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) };
  };

  const refreshGesture = () => {
    const points = [...pointersRef.current.values()];
    if (points.length === 0) gestureRef.current = null;
    else if (points.length === 1) gestureRef.current = { centroid: points[0]!, distance: null };
    else gestureRef.current = { centroid: centroid(points[0]!, points[1]!), distance: distance(points[0]!, points[1]!) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointersRef.current.size >= 2) return;
    pointersRef.current.set(event.pointerId, pointerPoint(event));
    if (pointersRef.current.size === 1) {
      movedRef.current = false;
      draggingRef.current = false;
    }
    refreshGesture();
    gestureStartRef.current = gestureRef.current?.centroid ?? null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, pointerPoint(event));
    const prior = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (prior === null || points.length === 0) return refreshGesture();
    const nextCentroid = points.length === 1 ? points[0]! : centroid(points[0]!, points[1]!);
    const startedDragging = points.length > 1 || (
      gestureStartRef.current !== null
      && exceedsDragThreshold(gestureStartRef.current, nextCentroid, DRAG_THRESHOLD)
    );
    if (!draggingRef.current && startedDragging) {
      draggingRef.current = true;
      movedRef.current = true;
      for (const pointerId of pointersRef.current.keys()) {
        event.currentTarget.setPointerCapture(pointerId);
      }
    }
    if (!draggingRef.current) {
      gestureRef.current = { centroid: nextCentroid, distance: null };
      return;
    }
    setTransform((current) => {
      let next = panTransform(current, {
        x: nextCentroid.x - prior.centroid.x,
        y: nextCentroid.y - prior.centroid.y,
      }, size, WORLD_CONTENT_SIZE);
      if (points.length > 1 && prior.distance !== null && prior.distance > 0) {
        const nextDistance = distance(points[0]!, points[1]!);
        if (Math.abs(nextDistance - prior.distance) >= 1) movedRef.current = true;
        next = zoomTransform(next, next.scale * nextDistance / prior.distance, nextCentroid, size, WORLD_CONTENT_SIZE);
      }
      return next;
    });
    gestureRef.current = {
      centroid: nextCentroid,
      distance: points.length > 1 ? distance(points[0]!, points[1]!) : null,
    };
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    refreshGesture();
    gestureStartRef.current = gestureRef.current?.centroid ?? null;
    if (pointersRef.current.size === 0) draggingRef.current = false;
  };

  const zoomAtCenter = (factor: number) => setTransform((current) => zoomTransform(
    current,
    current.scale * factor,
    { x: size.width / 2, y: size.height / 2 },
    size,
    WORLD_CONTENT_SIZE,
  ));

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaScale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(1, size.height)
        : 1;
    const deltaY = event.deltaY * deltaScale;
    setTransform((current) => zoomTransform(
      current,
      current.scale * Math.exp(-deltaY * 0.0015),
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      size,
      WORLD_CONTENT_SIZE,
    ));
  };

  const projection = useMemo<WorldViewportProjection>(() => ({
    transform,
    viewportSize: size,
    contentSize: WORLD_CONTENT_SIZE,
  }), [size, transform]);

  return (
    <WorldViewportContext.Provider value={projection}>
      <section className={styles.shell} aria-label="Interactive World map">
        <div className={styles.controls}>
          <button type="button" aria-label="Zoom out" onClick={() => zoomAtCenter(0.8)}>−</button>
          <output aria-label="World zoom">{Math.round(transform.scale * 100)}%</output>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAtCenter(1.25)}>+</button>
        </div>
        <div
          ref={hostRef}
          className={styles.viewport}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onLostPointerCapture={finishPointer}
          onClickCapture={(event) => {
            if (movedRef.current) {
              event.preventDefault();
              event.stopPropagation();
              movedRef.current = false;
            }
          }}
        >
          {children}
        </div>
        <p className={styles.hint}>Drag to pan. Scroll or pinch to zoom.</p>
      </section>
    </WorldViewportContext.Provider>
  );
}
