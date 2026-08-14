import assert from "node:assert/strict";
import test from "node:test";

import type { Bot, BotBattleState } from "../src/Bot.ts";
import { BotBattleController } from "../src/BotBattleController.ts";
import {
  ALPHA,
  createBattleSnapshot,
  ManualBotClock,
  RecordingConnection,
} from "./helpers.ts";

class RecordingBot implements Bot {
  readonly states: BotBattleState[] = [];
  action: ReturnType<Bot["decide"]> = {
    type: "incrementCell",
    position: { x: 0, y: 0 },
  };

  decide(state: BotBattleState): ReturnType<Bot["decide"]> {
    this.states.push(state);
    return this.action;
  }
}

function createController(
  connection: RecordingConnection,
  bot: Bot,
  clock = new ManualBotClock(),
  onError?: (error: Error) => void,
): BotBattleController {
  return new BotBattleController(connection, ALPHA, bot, {
    clock,
    clientState: {
      clock,
      probeIntervalMs: 60_000,
      requestIdFactory: (() => {
        let sequence = 0;
        return () => `request-${sequence++}`;
      })(),
    },
    ...(onError === undefined ? {} : { onError }),
  });
}

test("decides immediately, sends one command, and waits for authoritative resolution", async () => {
  const connection = new RecordingConnection();
  const bot = new RecordingBot();
  const controller = createController(connection, bot);

  assert.equal(bot.states.length, 1);
  assert.equal(bot.states[0]?.hasLocalCommandPending, false);
  assert.deepEqual(connection.sent, [{
    type: "incrementCell",
    requestId: "request-0",
    position: { x: 0, y: 0 },
  }]);

  connection.emit({
    type: "cellIncremented",
    tick: 0,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 2 },
    source: "command",
  });
  assert.equal(bot.states.length, 1);
  connection.emit({
    type: "cooldownChanged",
    tick: 0,
    cooldown: { participantId: ALPHA, nextActionTick: 4, durationTicks: 4 },
  });
  assert.equal(bot.states.length, 1);
  assert.equal(controller.view.hasLocalCommandPending, false);
  await controller.dispose();
});

test("keeps one replaceable cooldown wake and rereads authoritative state at expiry", async () => {
  const snapshot = createBattleSnapshot();
  snapshot.cooldowns = [{ participantId: ALPHA, nextActionTick: 4, durationTicks: 4 }];
  const connection = new RecordingConnection(snapshot);
  const bot = new RecordingBot();
  const clock = new ManualBotClock();
  const controller = createController(connection, bot, clock);

  assert.equal(bot.states.length, 0);
  assert.equal(clock.activeTimeoutCount, 1);
  connection.emit({
    type: "cellIncremented",
    tick: 1,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 7 },
    source: "split",
  });
  assert.equal(clock.activeTimeoutCount, 1);
  clock.advance(149);
  assert.equal(bot.states.length, 0);
  clock.advance(1);
  assert.equal(bot.states.length, 1);
  assert.equal(bot.states[0]?.snapshot.grid.cells[0]?.kind, "occupied");
  assert.equal(
    bot.states[0]?.snapshot.grid.cells[0]?.kind === "occupied"
      ? bot.states[0].snapshot.grid.cells[0].count
      : 0,
    7,
  );
  await controller.dispose();
});

test("backs off one tick after rejection and does not retry-spin", async () => {
  const connection = new RecordingConnection();
  const bot = new RecordingBot();
  const clock = new ManualBotClock();
  const controller = createController(connection, bot, clock);
  assert.equal(connection.sent.length, 1);

  connection.emit({
    type: "commandRejected",
    requestId: "request-0",
    reason: "cooldownActive",
  });
  assert.equal(bot.states.length, 1);
  assert.equal(clock.activeTimeoutCount, 1);
  clock.advance(49);
  assert.equal(connection.sent.length, 1);
  clock.advance(1);
  assert.equal(connection.sent.length, 2);
  assert.equal(bot.states.length, 2);
  await controller.dispose();
});

test("a null strategy sleeps until a later authoritative event", async () => {
  const connection = new RecordingConnection();
  const bot = new RecordingBot();
  bot.action = null;
  const clock = new ManualBotClock();
  const controller = createController(connection, bot, clock);

  assert.equal(bot.states.length, 1);
  assert.equal(clock.activeTimeoutCount, 0);
  clock.advance(5_000);
  assert.equal(bot.states.length, 1);
  connection.emit({
    type: "cellIncremented",
    tick: 100,
    position: { x: 0, y: 0 },
    cell: { kind: "occupied", participantId: ALPHA, count: 2 },
    source: "split",
  });
  assert.equal(bot.states.length, 2);
  await controller.dispose();
});

test("suppresses inactive and finished participants and disposes idempotently", async () => {
  const inactive = new RecordingConnection(createBattleSnapshot({ localStatus: "withdrawn" }));
  const inactiveBot = new RecordingBot();
  const controller = createController(inactive, inactiveBot);
  assert.equal(inactiveBot.states.length, 0);
  inactive.emit({
    type: "battleStatusChanged",
    tick: 2,
    status: { kind: "finished", winnerId: null },
  });
  assert.equal(inactiveBot.states.length, 0);
  await Promise.all([controller.dispose(), controller.dispose()]);
  assert.equal(inactive.closeCount, 1);
});

test("reports strategy and send failures without acting after disposal", async () => {
  const strategyFailure = new Error("strategy failed");
  const connection = new RecordingConnection();
  const errors: Error[] = [];
  const controller = createController(connection, {
    decide: () => { throw strategyFailure; },
  }, new ManualBotClock(), (error) => errors.push(error));
  assert.deepEqual(errors, [strategyFailure]);
  await controller.dispose();

  const sendConnection = new RecordingConnection();
  sendConnection.send = async () => { throw new Error("send failed"); };
  const sendErrors: Error[] = [];
  const sendController = createController(
    sendConnection,
    new RecordingBot(),
    new ManualBotClock(),
    (error) => sendErrors.push(error),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sendErrors[0]?.message, "send failed");
  await sendController.dispose();
});
