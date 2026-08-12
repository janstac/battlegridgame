export type ViewportTransform = Readonly<{ x: number; y: number; scale: number }>;
export type ViewportSize = Readonly<{ width: number; height: number }>;
export type ViewportPoint = Readonly<{ x: number; y: number }>;

export const MIN_WORLD_SCALE = 0.65;
export const MAX_WORLD_SCALE = 3.5;

export function clampScale(scale: number): number {
  return Math.min(MAX_WORLD_SCALE, Math.max(MIN_WORLD_SCALE, scale));
}

export function clampTransform(
  transform: ViewportTransform,
  viewport: ViewportSize,
  content: ViewportSize,
): ViewportTransform {
  const scale = clampScale(transform.scale);
  const scaledWidth = content.width * scale;
  const scaledHeight = content.height * scale;
  const minX = Math.min(0, viewport.width - scaledWidth);
  const minY = Math.min(0, viewport.height - scaledHeight);
  const centeredX = (viewport.width - scaledWidth) / 2;
  const centeredY = (viewport.height - scaledHeight) / 2;
  return {
    x: scaledWidth <= viewport.width
      ? centeredX
      : Math.min(0, Math.max(minX, transform.x)),
    y: scaledHeight <= viewport.height
      ? centeredY
      : Math.min(0, Math.max(minY, transform.y)),
    scale,
  };
}

export function panTransform(
  transform: ViewportTransform,
  delta: ViewportPoint,
  viewport: ViewportSize,
  content: ViewportSize,
): ViewportTransform {
  return clampTransform(
    { ...transform, x: transform.x + delta.x, y: transform.y + delta.y },
    viewport,
    content,
  );
}

/** Zooms while preserving the content point beneath the screen-space anchor. */
export function zoomTransform(
  transform: ViewportTransform,
  requestedScale: number,
  anchor: ViewportPoint,
  viewport: ViewportSize,
  content: ViewportSize,
): ViewportTransform {
  const scale = clampScale(requestedScale);
  const ratio = scale / transform.scale;
  return clampTransform({
    scale,
    x: anchor.x - (anchor.x - transform.x) * ratio,
    y: anchor.y - (anchor.y - transform.y) * ratio,
  }, viewport, content);
}

export function distance(first: ViewportPoint, second: ViewportPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function centroid(first: ViewportPoint, second: ViewportPoint): ViewportPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
