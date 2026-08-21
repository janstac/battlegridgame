import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  centroid,
  distance,
  exceedsDragThreshold,
  panTransform,
  resizeViewportCamera,
  zoomTransform,
  type ViewportCamera,
  type ViewportPoint,
  type ViewportSize,
  type ViewportTransform,
} from "./viewportMath.ts";
import styles from "./WorldViewport.module.css";
import {
  addWorldPointerTerminationListener,
  addWorldWheelListener,
  isWorldPointerContactActive,
  WorldPointerContacts,
  worldWheelTransform,
} from "./worldViewportInput.ts";

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
  const pointersRef = useRef(new WorldPointerContacts());
  const gestureRef = useRef<{ centroid: ViewportPoint; distance: number | null } | null>(null);
  const gestureStartRef = useRef<ViewportPoint | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const [camera, setCamera] = useState<ViewportCamera | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const update = () => {
      const size = { width: host.clientWidth, height: host.clientHeight };
      if (size.width <= 0 || size.height <= 0) return;
      setCamera((current) => resizeViewportCamera(current, size, WORLD_CONTENT_SIZE));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    return addWorldWheelListener(host, (event) => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setCamera((current) => current === null ? current : ({
        ...current,
        transform: worldWheelTransform(
          current.transform,
          event,
          bounds,
          current.size,
          WORLD_CONTENT_SIZE,
        ),
      }));
    });
  }, []);

  const pointerPoint = (event: ReactPointerEvent): ViewportPoint => {
    const bounds = hostRef.current?.getBoundingClientRect();
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) };
  };

  const refreshGesture = () => {
    const points = pointersRef.current.values();
    if (points.length === 0) gestureRef.current = null;
    else if (points.length === 1) gestureRef.current = { centroid: points[0]!, distance: null };
    else gestureRef.current = { centroid: centroid(points[0]!, points[1]!), distance: distance(points[0]!, points[1]!) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.begin(event, pointerPoint(event), event.currentTarget)) return;
    if (pointersRef.current.size === 1) {
      movedRef.current = false;
      draggingRef.current = false;
    }
    refreshGesture();
    gestureStartRef.current = gestureRef.current?.centroid ?? null;
  };

  const finishPointer = (pointerId: number) => {
    if (!pointersRef.current.finish(pointerId, hostRef.current ?? undefined)) return;
    refreshGesture();
    gestureStartRef.current = gestureRef.current?.centroid ?? null;
    if (pointersRef.current.size === 0) draggingRef.current = false;
  };

  useEffect(() => addWorldPointerTerminationListener(window, finishPointer), []);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    if (!isWorldPointerContactActive(event)) {
      finishPointer(event.pointerId);
      return;
    }
    pointersRef.current.update(event, pointerPoint(event));
    const prior = gestureRef.current;
    const points = pointersRef.current.values();
    if (prior === null || points.length === 0) return refreshGesture();
    const nextCentroid = points.length === 1 ? points[0]! : centroid(points[0]!, points[1]!);
    const startedDragging = points.length > 1 || (
      gestureStartRef.current !== null
      && exceedsDragThreshold(gestureStartRef.current, nextCentroid, DRAG_THRESHOLD)
    );
    if (!draggingRef.current && startedDragging) {
      draggingRef.current = true;
      movedRef.current = true;
      pointersRef.current.captureAll(event.currentTarget);
    }
    if (!draggingRef.current) {
      gestureRef.current = { centroid: nextCentroid, distance: null };
      return;
    }
    setCamera((current) => {
      if (current === null) return current;
      let transform = panTransform(current.transform, {
        x: nextCentroid.x - prior.centroid.x,
        y: nextCentroid.y - prior.centroid.y,
      }, current.size, WORLD_CONTENT_SIZE);
      if (points.length > 1 && prior.distance !== null && prior.distance > 0) {
        const nextDistance = distance(points[0]!, points[1]!);
        if (Math.abs(nextDistance - prior.distance) >= 1) movedRef.current = true;
        transform = zoomTransform(
          transform,
          transform.scale * nextDistance / prior.distance,
          nextCentroid,
          current.size,
          WORLD_CONTENT_SIZE,
        );
      }
      return { ...current, transform };
    });
    gestureRef.current = {
      centroid: nextCentroid,
      distance: points.length > 1 ? distance(points[0]!, points[1]!) : null,
    };
  };

  const zoomAtCenter = (factor: number) => setCamera((current) => current === null ? current : ({
    ...current,
    transform: zoomTransform(
      current.transform,
      current.transform.scale * factor,
      { x: current.size.width / 2, y: current.size.height / 2 },
      current.size,
      WORLD_CONTENT_SIZE,
    ),
  }));

  const projection = useMemo<WorldViewportProjection | null>(() => camera === null ? null : ({
    transform: camera.transform,
    viewportSize: camera.size,
    contentSize: WORLD_CONTENT_SIZE,
  }), [camera]);

  return (
    <WorldViewportContext.Provider value={projection}>
      <section className={styles.shell} aria-label="Interactive World map">
        <div className={styles.controls}>
          <button type="button" aria-label="Zoom out" onClick={() => zoomAtCenter(0.8)}>−</button>
          <output aria-label="World zoom">{Math.round((camera?.transform.scale ?? 1) * 100)}%</output>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAtCenter(1.25)}>+</button>
        </div>
        <div
          ref={hostRef}
          className={styles.viewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event.pointerId)}
          onPointerCancel={(event) => finishPointer(event.pointerId)}
          onLostPointerCapture={(event) => finishPointer(event.pointerId)}
          onClickCapture={(event) => {
            if (movedRef.current) {
              event.preventDefault();
              event.stopPropagation();
              movedRef.current = false;
            }
          }}
        >
          {projection === null ? null : children}
        </div>
      </section>
    </WorldViewportContext.Provider>
  );
}
