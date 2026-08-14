import assert from "node:assert/strict";
import test from "node:test";

import { getFlipDelta } from "../src/battle/battleFlip.ts";

test("getFlipDelta uses only vertical displacement at every viewport size", () => {
  assert.deepEqual(
    getFlipDelta({ top: 20 }, { top: 55 }),
    { x: 0, y: -35 },
  );
  assert.equal(
    getFlipDelta({ top: 20 }, { top: 20 }),
    null,
  );
});

test("getFlipDelta skips missing and invalid measurements", () => {
  assert.equal(getFlipDelta(undefined, { top: 20 }), null);
  assert.equal(getFlipDelta({ top: 20 }, undefined), null);
  assert.equal(
    getFlipDelta({ top: 20 }, { top: Number.POSITIVE_INFINITY }),
    null,
  );
});
