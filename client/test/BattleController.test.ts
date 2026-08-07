import assert from "node:assert/strict";
import test from "node:test";

import { BattleController } from "../src/controller/BattleController.ts";
import { BattleModel } from "../src/model/BattleModel.ts";
import {
  createBattleSnapshot,
  RecordingBattleSession,
} from "./helpers.ts";

test("turns a cell intent into a correlated command and clears old feedback", () => {
  const model = new BattleModel();
  const session = new RecordingBattleSession({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot(),
  });
  const controller = new BattleController(model, session, {
    requestIdFactory: () => "request-next",
  });
  controller.start();
  session.emit({
    type: "commandRejected",
    requestId: "request-old",
    battleId: "client-test",
    reason: "cooldownActive",
  });

  const requestId = controller.incrementCell({ x: 0, y: 0 });

  assert.equal(requestId, "request-next");
  assert.equal(model.getSnapshot().lastRejection, null);
  assert.deepEqual(session.sent, [
    {
      type: "incrementCell",
      requestId: "request-next",
      battleId: "client-test",
      position: { x: 0, y: 0 },
    },
  ]);
});

test("enforces startup and disposes its session exactly once", () => {
  const model = new BattleModel();
  const session = new RecordingBattleSession({
    type: "battleSnapshot",
    snapshot: createBattleSnapshot(),
  });
  const controller = new BattleController(model, session);

  assert.throws(
    () => controller.incrementCell({ x: 0, y: 0 }),
    /has not been started/,
  );
  controller.start();
  assert.throws(() => controller.start(), /already been started/);

  controller.dispose();
  controller.dispose();

  assert.equal(session.disposeCount, 1);
  assert.throws(
    () => controller.incrementCell({ x: 0, y: 0 }),
    /has been disposed/,
  );
  assert.throws(() => controller.start(), /has been disposed/);
});
