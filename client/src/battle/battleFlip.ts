export type FlipRect = Readonly<{
  left: number;
  top: number;
}>;

export type FlipDelta = Readonly<{
  x: number;
  y: number;
}>;

export function getFlipDelta(before: FlipRect | undefined, after: FlipRect | undefined): FlipDelta | null {
  if (before === undefined || after === undefined) return null;

  const x = before.left - after.left;
  const y = before.top - after.top;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;

  return { x, y };
}
