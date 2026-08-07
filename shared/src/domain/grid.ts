import Type from "typebox";

/** Builds a runtime schema for a row-major serialized grid. */
export function SerializedGridSchema<T extends Type.TSchema>(cellSchema: T) {
  return Type.Object(
    {
      width: Type.Integer({ minimum: 1 }),
      height: Type.Integer({ minimum: 1 }),
      cells: Type.Array(cellSchema),
    },
    { additionalProperties: false },
  );
}

/** Plain-data representation used in snapshots and protocol messages. */
export type SerializedGrid<T> = {
  width: number;
  height: number;
  cells: T[];
};

/** Infers the serialized-grid value type for a supplied cell schema. */
export type StaticSerializedGrid<T extends Type.TSchema> = Type.Static<
  ReturnType<typeof SerializedGridSchema<T>>
>;
