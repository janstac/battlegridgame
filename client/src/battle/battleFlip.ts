export type FlipRect = Readonly<{
  top: number;
}>;

export type FlipDelta = Readonly<{
  x: number;
  y: number;
}>;

export function getFlipDelta(
  before: FlipRect | undefined,
  after: FlipRect | undefined,
): FlipDelta | null {
  if (before === undefined || after === undefined) return null;

  const y = before.top - after.top;
  if (!Number.isFinite(y) || y === 0) return null;

  return { x: 0, y };
}
