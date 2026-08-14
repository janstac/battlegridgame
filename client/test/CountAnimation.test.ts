import assert from "node:assert/strict";
import test from "node:test";

import { shouldAnimateCountChange } from "../src/view/countAnimation.ts";

test("count feedback only animates increments", () => {
  assert.equal(shouldAnimateCountChange(2, 3), true);
  assert.equal(shouldAnimateCountChange(2, 2), false);
  assert.equal(shouldAnimateCountChange(3, 2), false);
  assert.equal(shouldAnimateCountChange(2, 3), true);
});
