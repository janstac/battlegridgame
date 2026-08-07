import type { Position, SerializedGrid } from "../domain/index.ts";

/** Error thrown when a coordinate or index lies outside a fixed grid. */
export class GridBoundsError extends RangeError {
  /** Coordinate that failed bounds validation. */
  readonly position: Position;

  /** Creates a bounds error for the rejected position. */
  constructor(position: Position) {
    super(`Grid position (${position.x}, ${position.y}) is out of bounds`);
    this.name = "GridBoundsError";
    this.position = position;
  }
}

/** Mutable, fixed-size, row-major grid with checked coordinate access. */
export class FixedGrid<T> {
  private readonly cellValues: T[];
  /** Grid width in cells. */
  readonly width: number;
  /** Grid height in cells. */
  readonly height: number;

  /** Creates and initializes every cell in a fixed-size grid. */
  constructor(
    width: number,
    height: number,
    createCell: (position: Position) => T,
  ) {
    void createCell;
    this.width = width;
    this.height = height;
    this.cellValues = [];
    throw new Error("FixedGrid is not implemented yet");
  }

  /** Restores a grid from its plain-data representation. */
  static fromData<T>(data: SerializedGrid<T>): FixedGrid<T> {
    void data;
    throw new Error("FixedGrid.fromData is not implemented yet");
  }

  /** Total number of cells. */
  get size(): number {
    return this.cellValues.length;
  }

  /** Returns whether a zero-based position is inside the grid. */
  contains(position: Position): boolean {
    void position;
    throw new Error("FixedGrid.contains is not implemented yet");
  }

  /** Converts a checked position to its row-major index. */
  indexOf(position: Position): number {
    void position;
    throw new Error("FixedGrid.indexOf is not implemented yet");
  }

  /** Converts a checked row-major index to a position. */
  positionOf(index: number): Position {
    void index;
    throw new Error("FixedGrid.positionOf is not implemented yet");
  }

  /** Returns the value at a checked position. */
  get(position: Position): T {
    void position;
    throw new Error("FixedGrid.get is not implemented yet");
  }

  /** Replaces the value at a checked position. */
  set(position: Position, value: T): void {
    void position;
    void value;
    throw new Error("FixedGrid.set is not implemented yet");
  }

  /** Returns in-bounds neighbours in stable up/right/down/left order. */
  orthogonalNeighbours(position: Position): Position[] {
    void position;
    throw new Error("FixedGrid.orthogonalNeighbours is not implemented yet");
  }

  /** Iterates positions and values in row-major order. */
  *entries(): IterableIterator<readonly [Position, T]> {
    throw new Error("FixedGrid.entries is not implemented yet");
  }

  /** Iterates values in row-major order. */
  values(): IterableIterator<T> {
    return this.cellValues.values();
  }

  /** Creates an independent grid using the supplied value copier. */
  clone(cloneValue: (value: T) => T): FixedGrid<T> {
    void cloneValue;
    throw new Error("FixedGrid.clone is not implemented yet");
  }

  /** Produces plain row-major data using the supplied value copier. */
  toData(cloneValue: (value: T) => T): SerializedGrid<T> {
    void cloneValue;
    throw new Error("FixedGrid.toData is not implemented yet");
  }
}
