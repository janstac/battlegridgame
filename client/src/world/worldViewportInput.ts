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

export type WorldPointerContact = Readonly<{
  buttons: number;
  pointerType: string;
}>;

export type WorldPointerStart = WorldPointerContact & Readonly<{
  button: number;
  pointerId: number;
}>;

export type WorldPointerMove = WorldPointerContact & Readonly<{
  pointerId: number;
}>;

export type WorldPointerCaptureTarget = Pick<
  Element,
  "hasPointerCapture" | "releasePointerCapture" | "setPointerCapture"
>;

/** Rejects a stale mouse move after its primary-button contact ended off-viewer. */
export function isWorldPointerContactActive(contact: WorldPointerContact): boolean {
  return contact.pointerType !== "mouse" || (contact.buttons & 1) !== 0;
}

/** Owns the accepted contacts and their pointer capture for one World gesture. */
export class WorldPointerContacts {
  readonly #points = new Map<number, ViewportPoint>();

  get size(): number {
    return this.#points.size;
  }

  begin(
    contact: WorldPointerStart,
    point: ViewportPoint,
    target: WorldPointerCaptureTarget,
  ): boolean {
    if (contact.pointerType === "mouse" && contact.button !== 0) return false;
    if (!this.#points.has(contact.pointerId) && this.#points.size >= 2) return false;
    this.#points.set(contact.pointerId, point);
    if (contact.pointerType !== "mouse") this.capture(contact.pointerId, target);
    return true;
  }

  has(pointerId: number): boolean {
    return this.#points.has(pointerId);
  }

  update(contact: WorldPointerMove, point: ViewportPoint): boolean {
    if (!this.#points.has(contact.pointerId) || !isWorldPointerContactActive(contact)) return false;
    this.#points.set(contact.pointerId, point);
    return true;
  }

  values(): ViewportPoint[] {
    return [...this.#points.values()];
  }

  captureAll(target: WorldPointerCaptureTarget): void {
    for (const pointerId of this.#points.keys()) this.capture(pointerId, target);
  }

  finish(pointerId: number, target?: WorldPointerCaptureTarget): boolean {
    const finished = this.#points.delete(pointerId);
    if (finished && target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    return finished;
  }

  private capture(pointerId: number, target: WorldPointerCaptureTarget): void {
    if (!target.hasPointerCapture(pointerId)) target.setPointerCapture(pointerId);
  }
}

/** Finishes tracked contacts even when an uncaptured pointer is released off-viewer. */
export function addWorldPointerTerminationListener(
  target: EventTarget,
  listener: (pointerId: number) => void,
): () => void {
  const handleTermination = (event: Event) => listener((event as PointerEvent).pointerId);
  target.addEventListener("pointerup", handleTermination);
  target.addEventListener("pointercancel", handleTermination);
  return () => {
    target.removeEventListener("pointerup", handleTermination);
    target.removeEventListener("pointercancel", handleTermination);
  };
}

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
