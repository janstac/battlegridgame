import { zoomTransform, type ViewportPoint, type ViewportSize, type ViewportTransform } from "./viewportMath.ts";

const WHEEL_LINE_HEIGHT = 16;
const WHEEL_ZOOM_RATE = 0.0015;

export type WorldWheelGesture = Readonly<{
  clientX: number;
  clientY: number;
  deltaMode: number;
  deltaY: number;
}>;

export type WorldWheelBounds = Readonly<{
  left: number;
  top: number;
}>;

/** Converts browser wheel units to the pixel scale used by viewport zoom. */
export function normalizeWorldWheelDelta(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  if (deltaMode === 1) return deltaY * WHEEL_LINE_HEIGHT;
  if (deltaMode === 2) return deltaY * Math.max(1, pageHeight);
  return deltaY;
}

export function worldWheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  return Math.exp(-normalizeWorldWheelDelta(deltaY, deltaMode, pageHeight) * WHEEL_ZOOM_RATE);
}

export function worldWheelTransform(
  transform: ViewportTransform,
  gesture: WorldWheelGesture,
  bounds: WorldWheelBounds,
  viewport: ViewportSize,
  content: ViewportSize,
): ViewportTransform {
  if (gesture.deltaY === 0) return transform;
  const anchor: ViewportPoint = {
    x: gesture.clientX - bounds.left,
    y: gesture.clientY - bounds.top,
  };
  return zoomTransform(
    transform,
    transform.scale * worldWheelZoomFactor(gesture.deltaY, gesture.deltaMode, viewport.height),
    anchor,
    viewport,
    content,
  );
}

/** Installs viewer-local wheel ownership with an explicit non-passive listener. */
export function addWorldWheelListener(
  target: HTMLElement,
  listener: (event: WheelEvent) => void,
): () => void {
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    listener(event);
  };
  target.addEventListener("wheel", handleWheel, { passive: false });
  return () => target.removeEventListener("wheel", handleWheel);
}
