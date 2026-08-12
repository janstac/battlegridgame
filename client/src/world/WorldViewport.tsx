import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import {
  centroid,
  clampTransform,
  distance,
  panTransform,
  zoomTransform,
  type ViewportPoint,
  type ViewportSize,
  type ViewportTransform,
} from "./viewportMath.ts";
import styles from "./WorldViewport.module.css";

const CONTENT_SIZE = { width: 640, height: 640 } as const;
const DRAG_THRESHOLD = 6;

export type WorldViewportProps = Readonly<{ children: ReactNode }>;

export function WorldViewport({ children }: WorldViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, ViewportPoint>());
  const gestureRef = useRef<{ centroid: ViewportPoint; distance: number | null } | null>(null);
  const movedRef = useRef(false);
  const gestureTravelRef = useRef(0);
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
    setTransform((current) => clampTransform(current, size, CONTENT_SIZE));
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
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, pointerPoint(event));
    if (pointersRef.current.size === 1) {
      movedRef.current = false;
      gestureTravelRef.current = 0;
    }
    refreshGesture();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, pointerPoint(event));
    const prior = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (prior === null || points.length === 0) return refreshGesture();
    const nextCentroid = points.length === 1 ? points[0]! : centroid(points[0]!, points[1]!);
    const travel = distance(prior.centroid, nextCentroid);
    gestureTravelRef.current += travel;
    if (gestureTravelRef.current >= DRAG_THRESHOLD) movedRef.current = true;
    setTransform((current) => {
      let next = panTransform(current, {
        x: nextCentroid.x - prior.centroid.x,
        y: nextCentroid.y - prior.centroid.y,
      }, size, CONTENT_SIZE);
      if (points.length > 1 && prior.distance !== null && prior.distance > 0) {
        const nextDistance = distance(points[0]!, points[1]!);
        if (Math.abs(nextDistance - prior.distance) >= 1) movedRef.current = true;
        next = zoomTransform(next, next.scale * nextDistance / prior.distance, nextCentroid, size, CONTENT_SIZE);
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
  };

  const zoomAtCenter = (factor: number) => setTransform((current) => zoomTransform(
    current,
    current.scale * factor,
    { x: size.width / 2, y: size.height / 2 },
    size,
    CONTENT_SIZE,
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
      CONTENT_SIZE,
    ));
  };

  return (
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
        <div
          className={styles.content}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          {children}
        </div>
      </div>
      <p className={styles.hint}>Drag to pan. Scroll or pinch to zoom.</p>
    </section>
  );
}
