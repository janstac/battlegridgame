import assert from "node:assert/strict";
import test from "node:test";

import { FixedGrid, GridBoundsError } from "../src/grid/index.ts";

test("FixedGrid initializes dimensions and row-major values", () => {
  const grid = new FixedGrid(3, 2, ({ x, y }) => `${x},${y}`);

  assert.equal(grid.width, 3);
  assert.equal(grid.height, 2);
  assert.equal(grid.size, 6);
  assert.deepEqual([...grid.values()], ["0,0", "1,0", "2,0", "0,1", "1,1", "2,1"]);
  assert.deepEqual([...grid.entries()], [
    [{ x: 0, y: 0 }, "0,0"],
    [{ x: 1, y: 0 }, "1,0"],
    [{ x: 2, y: 0 }, "2,0"],
    [{ x: 0, y: 1 }, "0,1"],
    [{ x: 1, y: 1 }, "1,1"],
    [{ x: 2, y: 1 }, "2,1"],
  ]);
});

test("FixedGrid validates dimensions and serialized cell count", () => {
  assert.throws(() => new FixedGrid(0, 2, () => 0), RangeError);
  assert.throws(() => new FixedGrid(2, -1, () => 0), RangeError);
  assert.throws(() => new FixedGrid(1.5, 2, () => 0), RangeError);
  assert.throws(
    () => FixedGrid.fromData({ width: 2, height: 2, cells: [1, 2, 3] }),
    RangeError,
  );
});

test("FixedGrid converts positions and indices in row-major order", () => {
  const grid = new FixedGrid(4, 3, () => null);

  assert.equal(grid.indexOf({ x: 0, y: 0 }), 0);
  assert.equal(grid.indexOf({ x: 3, y: 2 }), 11);
  assert.deepEqual(grid.positionOf(0), { x: 0, y: 0 });
  assert.deepEqual(grid.positionOf(6), { x: 2, y: 1 });
  assert.deepEqual(grid.positionOf(11), { x: 3, y: 2 });
});

test("FixedGrid rejects invalid positions and indices", () => {
  const grid = new FixedGrid(2, 2, () => 0);

  assert.equal(grid.contains({ x: 0, y: 0 }), true);
  assert.equal(grid.contains({ x: 2, y: 0 }), false);
  assert.equal(grid.contains({ x: -1, y: 1 }), false);
  assert.equal(grid.contains({ x: 0.5, y: 1 }), false);

  assert.throws(() => grid.get({ x: 2, y: 0 }), GridBoundsError);
  assert.throws(() => grid.set({ x: -1, y: 0 }, 1), GridBoundsError);
  assert.throws(() => grid.indexOf({ x: 0.5, y: 0 }), GridBoundsError);
  assert.throws(() => grid.positionOf(-1), RangeError);
  assert.throws(() => grid.positionOf(4), RangeError);
  assert.throws(() => grid.positionOf(1.5), RangeError);
});

test("FixedGrid returns orthogonal neighbours in stable up/right/down/left order", () => {
  const grid = new FixedGrid(3, 3, () => 0);

  assert.deepEqual(grid.orthogonalNeighbours({ x: 1, y: 1 }), [
    { x: 1, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 1 },
  ]);
  assert.deepEqual(grid.orthogonalNeighbours({ x: 0, y: 0 }), [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);
  assert.throws(() => grid.orthogonalNeighbours({ x: 3, y: 1 }), GridBoundsError);
});

test("FixedGrid serialization and cloning copy cell values independently", () => {
  const original = FixedGrid.fromData({
    width: 2,
    height: 1,
    cells: [{ value: 1 }, { value: 2 }],
  });
  const copyValue = (cell: { value: number }) => ({ ...cell });
  const clone = original.clone(copyValue);
  const serialized = original.toData(copyValue);

  clone.get({ x: 0, y: 0 }).value = 10;
  serialized.cells[1]!.value = 20;

  assert.deepEqual(original.toData(copyValue), {
    width: 2,
    height: 1,
    cells: [{ value: 1 }, { value: 2 }],
  });
});
