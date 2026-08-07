import Type from "typebox";

/** Runtime schema for a non-negative simulation tick. */
export const TickSchema = Type.Integer({ minimum: 0 });
/** Monotonically increasing logical simulation time. */
export type Tick = Type.Static<typeof TickSchema>;

/** Runtime schema for a zero-based grid position. */
export const PositionSchema = Type.Object(
  {
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
/** Zero-based Cartesian coordinate within a fixed grid. */
export type Position = Type.Static<typeof PositionSchema>;
