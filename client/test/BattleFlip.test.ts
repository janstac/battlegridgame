import assert from "node:assert/strict";
import test from "node:test";

import { getFlipDelta } from "../src/battle/battleFlip.ts";

test("getFlipDelta describes horizontal and vertical layout changes", () => {
  assert.deepEqual(getFlipDelta({ left: 12, top: 20 }, { left: 40, top: 20 }), { x: -28, y: 0 });
  assert.deepEqual(getFlipDelta({ left: 12, top: 20 }, { left: 12, top: 55 }), { x: 0, y: -35 });
  assert.deepEqual(getFlipDelta({ left: 12, top: 20 }, { left: 4, top: 5 }), { x: 8, y: 15 });
});

test("getFlipDelta skips unchanged, missing, and invalid measurements", () => {
  assert.equal(getFlipDelta({ left: 12, top: 20 }, { left: 12, top: 20 }), null);
  assert.equal(getFlipDelta(undefined, { left: 12, top: 20 }), null);
  assert.equal(getFlipDelta({ left: 12, top: 20 }, undefined), null);
  assert.equal(getFlipDelta({ left: Number.NaN, top: 20 }, { left: 12, top: 20 }), null);
  assert.equal(getFlipDelta({ left: 12, top: 20 }, { left: Number.POSITIVE_INFINITY, top: 20 }), null);
});
