export type FlipRect = Readonly<{
  left: number;
  top: number;
}>;

export type FlipDelta = Readonly<{
  x: number;
  y: number;
}>;

export type FlipAxis = "horizontal" | "vertical";

export function getFlipAxis(): FlipAxis {
  return window.matchMedia("(orientation: portrait)").matches
    ? "vertical"
    : "horizontal";
}

export function getFlipDelta(
  before: FlipRect | undefined,
  after: FlipRect | undefined,
  axis: FlipAxis,
): FlipDelta | null {
  if (before === undefined || after === undefined) return null;

  const x = before.left - after.left;
  const y = before.top - after.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const amount = axis === "horizontal" ? x : y;
  if (amount === 0) return null;

  return axis === "horizontal"
    ? { x: amount, y: 0 }
    : { x: 0, y: amount };
}
