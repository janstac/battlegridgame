import Type from "typebox";

/** Largest integer that can be represented exactly in protocol JSON numbers. */
export const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

/** Runtime schema for a non-negative simulation tick. */
export const TickSchema = Type.Integer({
  minimum: 0,
  maximum: SAFE_INTEGER_MAX,
});
/** Monotonically increasing logical simulation time. */
export type Tick = Type.Static<typeof TickSchema>;

/** Runtime schema for a zero-based grid position. */
export const PositionSchema = Type.Object(
  {
    x: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
    y: Type.Integer({ minimum: 0, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);
/** Zero-based Cartesian coordinate within a fixed grid. */
export type Position = Type.Static<typeof PositionSchema>;
