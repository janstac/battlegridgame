export type ViewportTransform = Readonly<{ x: number; y: number; scale: number }>;
export type ViewportSize = Readonly<{ width: number; height: number }>;
export type ViewportPoint = Readonly<{ x: number; y: number }>;
export type ViewportRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ViewportCamera = Readonly<{
  size: ViewportSize;
  transform: ViewportTransform;
}>;

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

/** Initializes from a measured viewport, then preserves and bounds the camera on later resizes. */
export function resizeViewportCamera(
  current: ViewportCamera | null,
  size: ViewportSize,
  content: ViewportSize,
): ViewportCamera {
  const transform = clampTransform(
    current?.transform ?? { x: 0, y: 0, scale: 1 },
    size,
    content,
  );
  if (
    current !== null
    && current.size.width === size.width
    && current.size.height === size.height
    && current.transform.x === transform.x
    && current.transform.y === transform.y
    && current.transform.scale === transform.scale
  ) return current;
  return { size, transform };
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

/** Returns the logical rectangle visible through a transformed content viewport. */
export function logicalViewBox(
  transform: ViewportTransform,
  viewport: ViewportSize,
  logical: ViewportSize,
  content: ViewportSize,
): ViewportRect {
  const fitScale = Math.min(content.width / logical.width, content.height / logical.height);
  const fittedWidth = logical.width * fitScale;
  const fittedHeight = logical.height * fitScale;
  const offsetX = (content.width - fittedWidth) / 2;
  const offsetY = (content.height - fittedHeight) / 2;
  return {
    x: ((-transform.x / transform.scale) - offsetX) / fitScale,
    y: ((-transform.y / transform.scale) - offsetY) / fitScale,
    width: viewport.width / transform.scale / fitScale,
    height: viewport.height / transform.scale / fitScale,
  };
}

/** Projects a point in fitted logical content into viewport pixels. */
export function projectLogicalPoint(
  point: ViewportPoint,
  transform: ViewportTransform,
  logical: ViewportSize,
  content: ViewportSize,
): ViewportPoint {
  const fitScale = Math.min(content.width / logical.width, content.height / logical.height);
  const offsetX = (content.width - logical.width * fitScale) / 2;
  const offsetY = (content.height - logical.height * fitScale) / 2;
  return {
    x: transform.x + (offsetX + point.x * fitScale) * transform.scale,
    y: transform.y + (offsetY + point.y * fitScale) * transform.scale,
  };
}

export function distance(first: ViewportPoint, second: ViewportPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function exceedsDragThreshold(
  start: ViewportPoint,
  current: ViewportPoint,
  threshold: number,
): boolean {
  return distance(start, current) >= threshold;
}

export function centroid(first: ViewportPoint, second: ViewportPoint): ViewportPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
