import assert from "node:assert/strict";
import test from "node:test";

import { getFlipDelta } from "../src/battle/battleFlip.ts";

test("getFlipDelta uses only the horizontal displacement for landscape", () => {
  assert.deepEqual(
    getFlipDelta({ left: 12, top: 20 }, { left: 40, top: 55 }, "horizontal"),
    { x: -28, y: 0 },
  );
  assert.equal(
    getFlipDelta({ left: 12, top: 20 }, { left: 12, top: 55 }, "horizontal"),
    null,
  );
});

test("getFlipDelta uses only the vertical displacement for portrait", () => {
  assert.deepEqual(
    getFlipDelta({ left: 12, top: 20 }, { left: 40, top: 55 }, "vertical"),
    { x: 0, y: -35 },
  );
  assert.equal(
    getFlipDelta({ left: 12, top: 20 }, { left: 40, top: 20 }, "vertical"),
    null,
  );
});

test("getFlipDelta skips missing and invalid measurements", () => {
  assert.equal(getFlipDelta(undefined, { left: 12, top: 20 }, "horizontal"), null);
  assert.equal(getFlipDelta({ left: 12, top: 20 }, undefined, "vertical"), null);
  assert.equal(
    getFlipDelta(
      { left: Number.NaN, top: 20 },
      { left: 12, top: 20 },
      "horizontal",
    ),
    null,
  );
  assert.equal(
    getFlipDelta(
      { left: 12, top: 20 },
      { left: 12, top: Number.POSITIVE_INFINITY },
      "vertical",
    ),
    null,
  );
});
