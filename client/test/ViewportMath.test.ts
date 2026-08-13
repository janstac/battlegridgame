import assert from "node:assert/strict";
import test from "node:test";

import { moveBattle } from "../src/battle/battleOrder.ts";
import {
  MAX_WORLD_SCALE,
  MIN_WORLD_SCALE,
  centroid,
  clampScale,
  clampTransform,
  distance,
  exceedsDragThreshold,
  logicalViewBox,
  panTransform,
  projectLogicalPoint,
  zoomTransform,
} from "../src/world/viewportMath.ts";

test("viewport scale and translation are clamped to keep content visible", () => {
  assert.equal(clampScale(0), MIN_WORLD_SCALE);
  assert.equal(clampScale(20), MAX_WORLD_SCALE);
  assert.deepEqual(
    clampTransform({ x: 99, y: -999, scale: 1 }, { width: 400, height: 300 }, { width: 640, height: 640 }),
    { x: 0, y: -340, scale: 1 },
  );
});

test("panning applies screen deltas and remains bounded", () => {
  assert.deepEqual(
    panTransform({ x: -100, y: -100, scale: 1 }, { x: -50, y: 40 }, { width: 400, height: 400 }, { width: 640, height: 640 }),
    { x: -150, y: -60, scale: 1 },
  );
});

test("anchored zoom preserves the content point beneath the anchor", () => {
  const anchor = { x: 200, y: 150 };
  const before = { x: -100, y: -80, scale: 1 };
  const after = zoomTransform(before, 2, anchor, { width: 400, height: 300 }, { width: 1_000, height: 1_000 });
  assert.equal((anchor.x - before.x) / before.scale, (anchor.x - after.x) / after.scale);
  assert.equal((anchor.y - before.y) / before.scale, (anchor.y - after.y) / after.scale);
});

test("SVG viewBox represents the transformed visible content without raster scaling", () => {
  assert.deepEqual(
    logicalViewBox(
      { x: -320, y: -160, scale: 2 },
      { width: 640, height: 320 },
      { width: 32, height: 32 },
      { width: 640, height: 640 },
    ),
    { x: 8, y: 4, width: 16, height: 8 },
  );
});

test("SVG viewBox and HTML overlays share fitted logical coordinates", () => {
  const transform = { x: -100, y: -50, scale: 1.5 };
  const viewport = { width: 500, height: 300 };
  const logical = { width: 20, height: 10 };
  const content = { width: 640, height: 640 };
  const point = { x: 12, y: 4 };
  const viewBox = logicalViewBox(transform, viewport, logical, content);
  const projected = projectLogicalPoint(point, transform, logical, content);

  assert.ok(Math.abs(projected.x - (point.x - viewBox.x) / viewBox.width * viewport.width) < 1e-9);
  assert.ok(Math.abs(projected.y - (point.y - viewBox.y) / viewBox.height * viewport.height) < 1e-9);
});

test("pinch helpers calculate centroid and distance", () => {
  assert.deepEqual(centroid({ x: 10, y: 20 }, { x: 30, y: 60 }), { x: 20, y: 40 });
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("drag threshold uses displacement from the pointer start", () => {
  const start = { x: 10, y: 10 };
  assert.equal(exceedsDragThreshold(start, { x: 15, y: 10 }, 6), false);
  assert.equal(exceedsDragThreshold(start, { x: 16, y: 10 }, 6), true);
  assert.equal(exceedsDragThreshold(start, { x: 10, y: 10 }, 6), false);
});

test("battle ordering is pure and bounded", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveBattle(order, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveBattle(order, "b", 1), ["a", "c", "b"]);
  assert.equal(moveBattle(order, "a", -1), order);
  assert.equal(moveBattle(order, "missing", 1), order);
});
