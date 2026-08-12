import assert from "node:assert/strict";
import test from "node:test";

import {
  BattleEngine,
  BattleState,
  FixedCooldownPolicy,
  applyBattleServerMessage,
  type ServerMessage,
} from "@grid-game/shared";
import { LocalBattleEngineConnection } from "../src/session/LocalBattleEngineConnection.ts";
import { ALPHA, createBattleSetup, ManualBattleClock } from "./helpers.ts";

test("delivers individual state facts asynchronously", async () => {
  const clock = new ManualBattleClock();
  const setup = createBattleSetup();
  const config = { ticksPerSecond: 20, splitDelayTicks: 10 };
  const connection = await LocalBattleEngineConnection.connect({
    setup,
    participantId: ALPHA,
    config,
    cooldownPolicy: new FixedCooldownPolicy(0),
    clock,
  });
  const messages: ServerMessage[] = [];
  connection.subscribe((message) => messages.push(message));

  const pending = connection.send({
    type: "incrementCell",
    requestId: "alpha-command",
    position: { x: 0, y: 0 },
  });
  assert.equal(messages.length, 0);
  await pending;
  assert.deepEqual(messages.map(({ type }) => type), [
    "cellIncremented",
    "splitScheduled",
    "cooldownChanged",
  ]);
  assert.equal(messages.some((message) => "snapshot" in message), false);

  let projected = BattleState.restore(connection.initialSnapshot);
  for (const message of messages) {
    if (message.type !== "commandRejected" && message.type !== "tickProbeResult") {
      projected = applyBattleServerMessage(projected, message);
    }
  }
  const expected = BattleEngine.create(setup, config, new FixedCooldownPolicy(0));
  expected.applyCommand(
    { participantId: ALPHA },
    { kind: "incrementCell", position: { x: 0, y: 0 } },
  );
  assert.deepEqual(projected.toSnapshot(), expected.getSnapshot());
  await connection.close();
});

test("quiet ticks send no snapshots and probes report authoritative tick", async () => {
  const clock = new ManualBattleClock();
  const connection = await LocalBattleEngineConnection.connect({
    setup: createBattleSetup(),
    participantId: ALPHA,
    clock,
  });
  const messages: ServerMessage[] = [];
  connection.subscribe((message) => messages.push(message));
  clock.runTicks(2);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(messages, []);

  await connection.send({ type: "tickProbe", probeId: "probe-1" });
  assert.deepEqual(messages, [
    { type: "tickProbeResult", probeId: "probe-1", tick: 2 },
  ]);
  await connection.close();
  assert.equal(clock.activeTimerCount, 0);
});
