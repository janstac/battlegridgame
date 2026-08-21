import assert from "node:assert/strict";
import test from "node:test";

import { challengeActionDisabled } from "../src/app/challengeAvailability.ts";

test("Challenge is natively disabled while busy or server capacity is unavailable", () => {
  assert.equal(challengeActionDisabled(false, true), false);
  assert.equal(challengeActionDisabled(true, true), true);
  assert.equal(challengeActionDisabled(false, false), true);
  assert.equal(challengeActionDisabled(true, false), true);
});
