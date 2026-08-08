import assert from "node:assert/strict";
import test from "node:test";

import { FixedCooldownPolicy, type ServerMessage } from "@grid-game/shared";

import { LocalBattleSession } from "../src/session/LocalBattleSession.ts";
import {
  ALPHA,
  BETA,
  createBattleSetup,
  ManualBattleClock,
} from "./helpers.ts";

test("reset replaces authoritative state without duplicating its timer", () => {
  const clock = new ManualBattleClock();
  const messages: ServerMessage[] = [];
  const session = new LocalBattleSession({
    setup: createBattleSetup("original"),
    playerId: ALPHA,
    clock,
  });
  session.start((message) => messages.push(message));

  assert.equal(clock.activeTimerCount, 1);
  clock.runTicks(2);
  const advancedMessage = messages.at(-1);
  assert.equal(advancedMessage?.type, "battleAdvanced");
  if (advancedMessage?.type === "battleAdvanced") {
    assert.equal(advancedMessage.snapshot.tick, 2);
  }

  session.reset(createBattleSetup("replacement"), BETA);

  assert.equal(session.activePlayerId, BETA);
  assert.equal(clock.activeTimerCount, 1);
  const resetMessage = messages.at(-1);
  assert.equal(resetMessage?.type, "battleSnapshot");
  if (resetMessage?.type === "battleSnapshot") {
    assert.equal(resetMessage.snapshot.battleId, "replacement");
    assert.equal(resetMessage.snapshot.tick, 0);
  }
  session.dispose();
});

test("active-player switching controls the identity used for commands", () => {
  const clock = new ManualBattleClock();
  const messages: ServerMessage[] = [];
  const session = new LocalBattleSession({
    setup: createBattleSetup(),
    playerId: ALPHA,
    cooldownPolicy: new FixedCooldownPolicy(0),
    clock,
  });
  session.start((message) => messages.push(message));

  session.setActivePlayer(BETA);
  session.send({
    type: "incrementCell",
    requestId: "beta-command",
    battleId: "client-test",
    position: { x: 2, y: 1 },
  });
  assert.equal(messages.at(-1)?.type, "commandAccepted");

  session.setActivePlayer(ALPHA);
  session.send({
    type: "incrementCell",
    requestId: "alpha-command",
    battleId: "client-test",
    position: { x: 0, y: 0 },
  });
  const accepted = messages.at(-1);
  assert.equal(accepted?.type, "commandAccepted");
  if (accepted?.type === "commandAccepted") {
    assert.equal(accepted.requestId, "alpha-command");
    assert.equal(accepted.snapshot.battleId, "client-test");
  }
  assert.throws(() => session.send({
    type: "incrementCell",
    requestId: "wrong-battle",
    battleId: "other-battle",
    position: { x: 0, y: 0 },
  }), /Unknown battle/);
  assert.throws(() => session.setActivePlayer("unknown"), /Unknown battle player/);
  session.dispose();
});

test("dispose cancels ticking and releases lifecycle resources idempotently", () => {
  const clock = new ManualBattleClock();
  const messages: ServerMessage[] = [];
  const session = new LocalBattleSession({
    setup: createBattleSetup(),
    playerId: ALPHA,
    clock,
  });
  session.start((message) => messages.push(message));
  assert.equal(messages.length, 1);

  session.dispose();
  session.dispose();
  clock.runTicks(3);

  assert.equal(clock.activeTimerCount, 0);
  assert.equal(clock.clearCount, 1);
  assert.equal(messages.length, 1);
  assert.throws(
    () => session.setActivePlayer(BETA),
    /LocalBattleSession has been disposed/,
  );
  assert.throws(
    () => session.reset(createBattleSetup("replacement")),
    /LocalBattleSession has been disposed/,
  );
});
