import type { Position, SerializedGrid } from "../domain/index.ts";

/** Error thrown when a coordinate lies outside a fixed grid. */
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
    if (!Number.isSafeInteger(width) || width < 1) {
      throw new RangeError("Grid width must be a positive safe integer");
    }
    if (!Number.isSafeInteger(height) || height < 1) {
      throw new RangeError("Grid height must be a positive safe integer");
    }

    this.width = width;
    this.height = height;
    this.cellValues = new Array<T>(width * height);
    for (let index = 0; index < this.cellValues.length; index += 1) {
      this.cellValues[index] = createCell(this.uncheckedPositionOf(index));
    }
  }

  /** Restores a grid from its plain-data representation. */
  static fromData<T>(data: SerializedGrid<T>): FixedGrid<T> {
    if (data.cells.length !== data.width * data.height) {
      throw new RangeError(
        `Serialized grid contains ${data.cells.length} cells; expected ${data.width * data.height}`,
      );
    }
    return new FixedGrid(data.width, data.height, (position) =>
      data.cells[position.y * data.width + position.x] as T,
    );
  }

  /** Total number of cells. */
  get size(): number {
    return this.cellValues.length;
  }

  /** Returns whether a zero-based position is inside the grid. */
  contains(position: Position): boolean {
    return (
      Number.isInteger(position.x) &&
      Number.isInteger(position.y) &&
      position.x >= 0 &&
      position.x < this.width &&
      position.y >= 0 &&
      position.y < this.height
    );
  }

  /** Converts a checked position to its row-major index. */
  indexOf(position: Position): number {
    if (!this.contains(position)) {
      throw new GridBoundsError(position);
    }
    return position.y * this.width + position.x;
  }

  /** Converts a checked row-major index to a position. */
  positionOf(index: number): Position {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`Grid index ${index} is out of bounds`);
    }
    return this.uncheckedPositionOf(index);
  }

  /** Returns the value at a checked position. */
  get(position: Position): T {
    return this.cellValues[this.indexOf(position)] as T;
  }

  /** Replaces the value at a checked position. */
  set(position: Position, value: T): void {
    this.cellValues[this.indexOf(position)] = value;
  }

  /** Returns in-bounds neighbours in stable up/right/down/left order. */
  orthogonalNeighbours(position: Position): Position[] {
    this.indexOf(position);
    const candidates: Position[] = [
      { x: position.x, y: position.y - 1 },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x - 1, y: position.y },
    ];
    return candidates.filter((candidate) => this.contains(candidate));
  }

  /** Iterates positions and values in row-major order. */
  *entries(): IterableIterator<readonly [Position, T]> {
    for (let index = 0; index < this.size; index += 1) {
      yield [this.uncheckedPositionOf(index), this.cellValues[index] as T];
    }
  }

  /** Iterates values in row-major order. */
  values(): IterableIterator<T> {
    return this.cellValues.values();
  }

  /** Creates an independent grid using the supplied value copier. */
  clone(cloneValue: (value: T) => T): FixedGrid<T> {
    return FixedGrid.fromData(this.toData(cloneValue));
  }

  /** Produces plain row-major data using the supplied value copier. */
  toData(cloneValue: (value: T) => T): SerializedGrid<T> {
    return {
      width: this.width,
      height: this.height,
      cells: this.cellValues.map(cloneValue),
    };
  }

  private uncheckedPositionOf(index: number): Position {
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }
}
