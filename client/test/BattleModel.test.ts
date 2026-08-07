import assert from "node:assert/strict";
import test from "node:test";

import {
  BattleModel,
  type BattleModelState,
} from "../src/model/BattleModel.ts";
import { createBattleSnapshot } from "./helpers.ts";

test("publishes stable revisions and stops notifying unsubscribed listeners", () => {
  const model = new BattleModel();
  const initial = model.getSnapshot();
  const observed: BattleModelState[] = [];
  const unsubscribe = model.subscribe(() => observed.push(model.getSnapshot()));
  const snapshot = createBattleSnapshot();

  model.applyAuthoritativeMessage({ type: "battleSnapshot", snapshot });

  assert.notEqual(model.getSnapshot(), initial);
  assert.equal(observed.length, 1);
  assert.equal(observed[0], model.getSnapshot());

  unsubscribe();
  model.applyAuthoritativeMessage({
    type: "battleAdvanced",
    events: [],
    snapshot: createBattleSnapshot("client-test", 1),
  });
  assert.equal(observed.length, 1);
});

test("preserves rejection feedback across battle-advanced heartbeats", () => {
  const model = new BattleModel();
  model.applyAuthoritativeMessage({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot(),
  });
  model.applyAuthoritativeMessage({
    type: "commandRejected",
    requestId: "request-rejected",
    battleId: "client-test",
    reason: "cooldownActive",
  });

  model.applyAuthoritativeMessage({
    type: "battleAdvanced",
    events: [],
    snapshot: createBattleSnapshot("client-test", 1),
  });

  assert.equal(model.getSnapshot().snapshot?.tick, 1);
  assert.deepEqual(model.getSnapshot().lastRejection, {
    requestId: "request-rejected",
    reason: "cooldownActive",
  });
});

test("clears rejection feedback on acceptance, replacement, and explicit clear", () => {
  const model = new BattleModel();
  const rejection = {
    type: "commandRejected",
    requestId: "request-rejected",
    battleId: "client-test",
    reason: "notOwner",
  } as const;

  model.applyAuthoritativeMessage(rejection);
  model.clearRejection();
  assert.equal(model.getSnapshot().lastRejection, null);

  model.applyAuthoritativeMessage(rejection);
  model.applyAuthoritativeMessage({
    type: "commandAccepted",
    requestId: "request-accepted",
    events: [],
    snapshot: createBattleSnapshot(),
  });
  assert.equal(model.getSnapshot().lastRejection, null);

  model.applyAuthoritativeMessage(rejection);
  model.applyAuthoritativeMessage({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot("replacement"),
  });
  assert.equal(model.getSnapshot().lastRejection, null);
});
