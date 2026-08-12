import assert from "node:assert/strict";
import test from "node:test";
import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleCell,
  type ServerMessage,
} from "@grid-game/shared";
import { BattleRegistry } from "../src/game/BattleRegistry.ts";
import {
  HostedBattle,
  type HostedBattleClock,
  type HostedBattleTerminalResult,
} from "../src/game/HostedBattle.ts";
import { StandardBattleFactory } from "../src/game/StandardBattleFactory.ts";

class ManualClock implements HostedBattleClock {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 0;
  clearCount = 0;

  setInterval(callback: () => void, _intervalMs: number): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === "number" && this.callbacks.delete(handle)) {
      this.clearCount += 1;
    }
  }

  runTick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }

  get runningIntervals(): number { return this.callbacks.size; }
}

async function flushOperations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("uses local command identity and serializes a command before withdrawal", async () => {
  const battle = new StandardBattleFactory().create(["alice", "bob", "carol"]);
  const messages: ServerMessage[] = [];
  battle.attach((message) => messages.push(message));

  const command = battle.receive(0, {
    type: "incrementCell",
    requestId: "increment",
    position: { x: 1, y: 1 },
  }, (message) => messages.push(message));
  const withdrawal = battle.withdraw(0);
  await Promise.all([command, withdrawal]);

  assert.equal(messages[0]?.type, "cellIncremented");
  assert.deepEqual(
    messages.find((message) => message.type === "cellIncremented"),
    {
      type: "cellIncremented",
      tick: 0,
      position: { x: 1, y: 1 },
      cell: { kind: "occupied", participantId: 0, count: 2 },
      source: "command",
    },
  );
  assert.deepEqual(battle.getRoster()[0], {
    participantId: 0,
    playerId: "alice",
    status: "withdrawn",
  });

  const replies: ServerMessage[] = [];
  await battle.receive(1, {
    type: "incrementCell",
    requestId: "wrong-owner",
    position: { x: 1, y: 1 },
  }, (message) => replies.push(message));
  assert.deepEqual(replies, [{
    type: "commandRejected",
    requestId: "wrong-owner",
    reason: "notOwner",
  }]);
});

test("publishes terminal facts, stops ticking, and calls each terminal observer once", async () => {
  const clock = new ManualClock();
  const battle = new StandardBattleFactory(clock).create(
    ["alice", "bob"],
    { x: 7, y: 8 },
  );
  const messages: ServerMessage[] = [];
  const outcomes: HostedBattleTerminalResult[] = [];
  battle.attach((message) => messages.push(message));
  battle.onTerminal((result) => outcomes.push(result));
  battle.onTerminal(() => { throw new Error("observer failure"); });
  battle.start();
  assert.equal(clock.runningIntervals, 1);

  await battle.withdraw(0);
  await battle.withdraw(0);

  assert.deepEqual(messages.map(({ type }) => type), [
    "participantChanged",
    "pendingSplitsCleared",
    "battleStatusChanged",
  ]);
  assert.deepEqual(outcomes, [{
    winnerParticipantId: 1,
    winnerPlayerId: "bob",
    worldPosition: { x: 7, y: 8 },
  }]);
  assert.equal(clock.runningIntervals, 0);
  assert.equal(clock.clearCount, 1);

  let lateCalls = 0;
  battle.onTerminal((result) => {
    lateCalls += 1;
    assert.equal(result.winnerPlayerId, "bob");
  });
  assert.equal(lateCalls, 1);
});

test("withdrawn participants keep ownership and already queued cascades continue", async () => {
  const clock = new ManualClock();
  const cells: BattleCell[] = Array.from(
    { length: 9 },
    (): BattleCell => ({ kind: "empty" }),
  );
  cells[4] = { kind: "occupied", participantId: 0, count: 3 };
  cells[0] = { kind: "occupied", participantId: 1, count: 1 };
  cells[8] = { kind: "occupied", participantId: 2, count: 1 };
  const engine = BattleEngine.create({
    participants: [0, 1, 2].map((participantId) => ({
      participantId,
      status: "active" as const,
    })),
    grid: { width: 3, height: 3, cells },
  }, {
    ...DEFAULT_BATTLE_CONFIG,
    splitDelayTicks: 1,
  }, new FixedCooldownPolicy(0));
  const battle = new HostedBattle(engine, [
    { participantId: 0, playerId: "alice" },
    { participantId: 1, playerId: "bob" },
    { participantId: 2, playerId: "carol" },
  ], { clock });
  const messages: ServerMessage[] = [];
  battle.attach((message) => messages.push(message));
  await battle.receive(0, {
    type: "incrementCell",
    requestId: "schedule",
    position: { x: 1, y: 1 },
  }, (message) => messages.push(message));
  await battle.withdraw(0);
  assert.equal(battle.snapshot.pendingSplits.length, 1);
  assert.deepEqual(battle.snapshot.grid.cells[4], {
    kind: "occupied",
    participantId: 0,
    count: 4,
  });

  battle.start();
  clock.runTick();
  await flushOperations();

  assert.equal(messages.some((message) => message.type === "cellSplit"), true);
  assert.equal(
    messages.some(
      (message) => message.type === "cellCaptured" && message.cell.participantId === 0,
    ),
    true,
  );
  assert.equal(battle.snapshot.status.kind, "running");
  await battle.dispose();
});

test("registry unregisters before disposal and can find a player's memberships", async () => {
  const registry = new BattleRegistry();
  const factory = new StandardBattleFactory();
  const first = factory.create(["alice", "bob"]);
  const second = factory.create(["alice", "carol"]);
  const firstId = registry.register(first);
  const secondId = registry.register(second);

  assert.deepEqual(
    registry.membershipsForPlayer("alice").map(({ battleId }) => battleId),
    [firstId, secondId],
  );
  assert.deepEqual(
    registry.membershipsForPlayer("bob").map(({ battleId }) => battleId),
    [firstId],
  );

  const firstRemoval = registry.remove(firstId);
  assert.equal(registry.get(firstId), undefined);
  assert.equal(await firstRemoval, true);
  const secondRemoval = registry.remove(secondId);
  assert.equal(registry.get(secondId), undefined);
  assert.equal(await secondRemoval, true);
  assert.equal(await registry.remove(secondId), false);
});
