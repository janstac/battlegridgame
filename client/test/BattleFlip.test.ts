import assert from "node:assert/strict";
import test from "node:test";

import { getFlipDelta } from "../src/battle/battleFlip.ts";

test("getFlipDelta supports movement across columns and rows", () => {
  assert.deepEqual(
    getFlipDelta({ left: 10, top: 20 }, { left: 45, top: 55 }),
    { x: -35, y: -35 },
  );
  assert.equal(
    getFlipDelta({ left: 10, top: 20 }, { left: 10, top: 20 }),
    null,
  );
});

test("getFlipDelta skips missing and invalid measurements", () => {
  assert.equal(getFlipDelta(undefined, { left: 10, top: 20 }), null);
  assert.equal(getFlipDelta({ left: 10, top: 20 }, undefined), null);
  assert.equal(
    getFlipDelta(
      { left: 10, top: 20 },
      { left: Number.POSITIVE_INFINITY, top: 20 },
    ),
    null,
  );
});
