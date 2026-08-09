import assert from "node:assert/strict";
import test from "node:test";

import type { BattleEvent, CommandResult } from "../src/game/index.ts";
import {
  BattleEngine,
  FixedCooldownPolicy,
} from "../src/game/index.ts";
import {
  ALPHA,
  BETA,
  cellAt,
  empty,
  makeGrid,
  makeSetup,
  makeSnapshot,
  occupied,
  wall,
} from "./helpers.ts";

const CONFIG = { ticksPerSecond: 20, splitDelayTicks: 10 } as const;
const NO_COOLDOWN = new FixedCooldownPolicy(0);

/** Applies an increment command and narrows the result to an accepted command. */
function increment(
  engine: BattleEngine,
  playerId: string,
  x: number,
  y: number,
): Extract<CommandResult, { accepted: true }> {
  const result = engine.applyCommand(
    { playerId },
    { kind: "incrementCell", position: { x, y } },
  );
  assert.equal(result.accepted, true);
  return result;
}

/** Returns the first event of a requested kind, failing when it is absent. */
function eventOfKind<K extends BattleEvent["kind"]>(
  events: readonly BattleEvent[],
  kind: K,
): Extract<BattleEvent, { kind: K }> {
  const event = events.find(
    (candidate): candidate is Extract<BattleEvent, { kind: K }> =>
      candidate.kind === kind,
  );
  assert.ok(event, `Expected a ${kind} event`);
  return event;
}

/** Advances the engine by an exact number of logical ticks. */
function advance(engine: BattleEngine, ticks: number): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    events.push(...engine.advanceTick().events);
  }
  return events;
}

test("increments owned cells and emits authoritative state changes", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(3, 2, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 2, y: 1 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    new FixedCooldownPolicy(4),
  );

  const result = increment(engine, ALPHA, 0, 0);
  assert.deepEqual(eventOfKind(result.events, "cellIncremented"), {
    kind: "cellIncremented",
    position: { x: 0, y: 0 },
    playerId: ALPHA,
    previousCount: 1,
    nextCount: 2,
    source: "command",
  });
  assert.deepEqual(eventOfKind(result.events, "cooldownStarted"), {
    kind: "cooldownStarted",
    playerId: ALPHA,
    nextActionTick: 4,
  });
  assert.deepEqual(cellAt(engine.getSnapshot().grid, { x: 0, y: 0 }), occupied(ALPHA, 2));
});

test("rejects invalid increment commands without changing the snapshot", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(3, 2, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 2, y: 1 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );

  const cases = [
    [{ playerId: "unknown" }, { x: 0, y: 0 }, "unknownPlayer"],
    [{ playerId: ALPHA }, { x: 3, y: 0 }, "outOfBounds"],
    [{ playerId: ALPHA }, { x: 1, y: 0 }, "notOccupied"],
    [{ playerId: ALPHA }, { x: 2, y: 1 }, "notOwner"],
  ] as const;

  for (const [context, position, reason] of cases) {
    const before = engine.getSnapshot();
    assert.deepEqual(
      engine.applyCommand(context, { kind: "incrementCell", position }),
      { accepted: false, reason },
    );
    assert.deepEqual(engine.getSnapshot(), before);
  }
});

test("split threshold reflects corner, edge, interior, and adjacent-wall topology", () => {
  const scenarios = [
    { name: "corner", position: { x: 0, y: 0 }, initialCount: 1, walls: [] },
    { name: "edge", position: { x: 2, y: 0 }, initialCount: 2, walls: [] },
    { name: "interior", position: { x: 2, y: 2 }, initialCount: 3, walls: [] },
    {
      name: "wall-adjacent interior",
      position: { x: 2, y: 2 },
      initialCount: 2,
      walls: [{ x: 2, y: 1 }],
    },
  ] as const;

  for (const scenario of scenarios) {
    const overrides: Array<readonly [{ x: number; y: number }, ReturnType<typeof occupied>]> = [
      [scenario.position, occupied(ALPHA, scenario.initialCount)],
      [{ x: 4, y: 4 }, occupied(BETA, 1)],
    ];
    const engine = BattleEngine.create(
      makeSetup(makeGrid(5, 5, [
        ...overrides,
        ...scenario.walls.map((position) => [position, wall()] as const),
      ])),
      CONFIG,
      NO_COOLDOWN,
    );

    const scheduled = eventOfKind(
      increment(engine, ALPHA, scenario.position.x, scenario.position.y).events,
      "splitScheduled",
    );
    assert.equal(scheduled.dueTick, 10, scenario.name);
    assert.deepEqual(scheduled.position, scenario.position, scenario.name);
  }
});

test("cooldowns are isolated by player and by battle", () => {
  const setup = () => makeSetup(makeGrid(4, 2, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 3, y: 1 }, occupied(BETA, 1)],
  ]));
  const first = BattleEngine.create(setup(), CONFIG, new FixedCooldownPolicy(5));
  const second = BattleEngine.create(setup(), CONFIG, new FixedCooldownPolicy(5));

  increment(first, ALPHA, 0, 0);
  assert.deepEqual(
    first.applyCommand(
      { playerId: ALPHA },
      { kind: "incrementCell", position: { x: 1, y: 0 } },
    ),
    { accepted: false, reason: "cooldownActive" },
  );

  // BETA and the separate battle retain independent action clocks.
  assert.equal(increment(first, BETA, 3, 1).accepted, true);
  assert.equal(increment(second, ALPHA, 0, 0).accepted, true);

  advance(first, 4);
  assert.deepEqual(
    first.applyCommand(
      { playerId: ALPHA },
      { kind: "incrementCell", position: { x: 1, y: 0 } },
    ),
    { accepted: false, reason: "cooldownActive" },
  );
  advance(first, 1);
  assert.equal(increment(first, ALPHA, 1, 0).accepted, true);
});

test("a threshold cell splits after exactly ten ticks", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(3, 3, [
      [{ x: 1, y: 1 }, occupied(ALPHA, 3)],
      [{ x: 0, y: 0 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );

  const command = increment(engine, ALPHA, 1, 1);
  assert.equal(eventOfKind(command.events, "splitScheduled").dueTick, 10);
  const earlyEvents = advance(engine, 9);
  assert.equal(earlyEvents.some(({ kind }) => kind === "cellSplit"), false);
  assert.deepEqual(cellAt(engine.getSnapshot().grid, { x: 1, y: 1 }), occupied(ALPHA, 4));

  const due = engine.advanceTick();
  assert.equal(due.tick, 10);
  assert.deepEqual(eventOfKind(due.events, "cellSplit"), {
    kind: "cellSplit",
    position: { x: 1, y: 1 },
    playerId: ALPHA,
    count: 4,
  });
  assert.deepEqual(cellAt(engine.getSnapshot().grid, { x: 1, y: 1 }), empty());
});

test("a split increments friendly, empty, and enemy cells while skipping walls", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(4, 3, [
      [{ x: 1, y: 1 }, occupied(ALPHA, 2)],
      [{ x: 1, y: 0 }, occupied(ALPHA, 2)],
      [{ x: 2, y: 1 }, occupied(BETA, 2)],
      [{ x: 0, y: 1 }, wall()],
      [{ x: 3, y: 2 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );

  increment(engine, ALPHA, 1, 1);
  const events = advance(engine, 10);
  const snapshot = engine.getSnapshot();

  assert.deepEqual(cellAt(snapshot.grid, { x: 1, y: 1 }), empty());
  assert.deepEqual(cellAt(snapshot.grid, { x: 1, y: 0 }), occupied(ALPHA, 3));
  assert.deepEqual(cellAt(snapshot.grid, { x: 2, y: 1 }), occupied(ALPHA, 3));
  assert.deepEqual(cellAt(snapshot.grid, { x: 1, y: 2 }), occupied(ALPHA, 1));
  assert.deepEqual(cellAt(snapshot.grid, { x: 0, y: 1 }), wall());

  const capture = events.find(
    (event) => event.kind === "cellCaptured" && event.position.x === 2 && event.position.y === 1,
  );
  assert.deepEqual(capture, {
    kind: "cellCaptured",
    position: { x: 2, y: 1 },
    playerId: ALPHA,
    previousPlayerId: BETA,
    previousCount: 2,
    nextCount: 3,
  });
});

test("same-tick pending splits resolve by sequence and use current ownership", () => {
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(3, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 2)],
      [{ x: 2, y: 0 }, occupied(BETA, 1)],
    ]), {
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
        { position: { x: 1, y: 0 }, dueTick: 1, sequence: 1 },
      ],
    }),
    NO_COOLDOWN,
  );

  const result = engine.advanceTick();
  const splits = result.events.filter((event) => event.kind === "cellSplit");

  // The first split captures the second queued source, so that source then
  // resolves for ALPHA rather than for its owner at scheduling time.
  assert.deepEqual(splits, [
    { kind: "cellSplit", position: { x: 0, y: 0 }, playerId: ALPHA, count: 1 },
    { kind: "cellSplit", position: { x: 1, y: 0 }, playerId: ALPHA, count: 3 },
  ]);
  assert.deepEqual(engine.status, { kind: "finished", winnerId: ALPHA });
});

test("a pending split captured on an earlier tick resolves for its new owner", () => {
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(3, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 2)],
      [{ x: 2, y: 0 }, occupied(BETA, 1)],
    ]), {
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
        { position: { x: 1, y: 0 }, dueTick: 2, sequence: 1 },
      ],
    }),
    NO_COOLDOWN,
  );

  engine.advanceTick();
  assert.deepEqual(cellAt(engine.getSnapshot().grid, { x: 1, y: 0 }), occupied(ALPHA, 3));
  const result = engine.advanceTick();
  assert.equal(eventOfKind(result.events, "cellSplit").playerId, ALPHA);
});

test("a split schedules a newly critical neighbour as a delayed chain reaction", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(4, 4, [
      [{ x: 1, y: 1 }, occupied(ALPHA, 3)],
      [{ x: 1, y: 0 }, occupied(ALPHA, 2)],
      [{ x: 3, y: 3 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );

  increment(engine, ALPHA, 1, 1);
  const firstWave = advance(engine, 10);
  const chained = firstWave.find(
    (event) => event.kind === "splitScheduled" && event.position.x === 1 && event.position.y === 0,
  );
  assert.deepEqual(chained, {
    kind: "splitScheduled",
    position: { x: 1, y: 0 },
    dueTick: 20,
    sequence: 1,
  });

  const waiting = advance(engine, 9);
  assert.equal(waiting.some(({ kind }) => kind === "cellSplit"), false);
  const secondWave = engine.advanceTick().events;
  assert.deepEqual(eventOfKind(secondWave, "cellSplit").position, { x: 1, y: 0 });
});

test("victory stops remaining same-tick splits and clears queued work", () => {
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(4, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 1)],
      [{ x: 3, y: 0 }, occupied(ALPHA, 1)],
    ]), {
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
        { position: { x: 3, y: 0 }, dueTick: 1, sequence: 1 },
      ],
    }),
    NO_COOLDOWN,
  );

  const result = engine.advanceTick();
  assert.deepEqual(result.events.filter(({ kind }) => kind === "cellSplit"), [
    { kind: "cellSplit", position: { x: 0, y: 0 }, playerId: ALPHA, count: 1 },
  ]);
  assert.deepEqual(eventOfKind(result.events, "battleWon"), {
    kind: "battleWon",
    winnerId: ALPHA,
  });
  assert.deepEqual(engine.getSnapshot().pendingSplits, []);

  const finished = engine.getSnapshot();
  assert.deepEqual(
    engine.applyCommand(
      { playerId: ALPHA },
      { kind: "incrementCell", position: { x: 1, y: 0 } },
    ),
    { accepted: false, reason: "battleFinished" },
  );
  assert.deepEqual(engine.advanceTick(), { tick: 1, events: [] });
  assert.deepEqual(engine.getSnapshot(), finished);
});

test("snapshots are independent and restore deterministic engine state", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(3, 3, [
      [{ x: 1, y: 1 }, occupied(ALPHA, 3)],
      [{ x: 0, y: 0 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    new FixedCooldownPolicy(3),
  );
  increment(engine, ALPHA, 1, 1);

  const restorable = engine.getSnapshot();
  const restored = BattleEngine.restore(restorable, new FixedCooldownPolicy(3));
  assert.deepEqual(restored.getSnapshot(), restorable);

  // Mutating caller-owned snapshot data must not mutate either engine.
  restorable.players.push("intruder");
  restorable.grid.cells[0] = wall();
  restorable.pendingSplits.length = 0;
  assert.equal(engine.getSnapshot().players.includes("intruder"), false);
  assert.notDeepEqual(cellAt(engine.getSnapshot().grid, { x: 0, y: 0 }), wall());
  assert.equal(engine.getSnapshot().pendingSplits.length, 1);

  assert.deepEqual(advance(restored, 10), advance(engine, 10));
  assert.deepEqual(restored.getSnapshot(), engine.getSnapshot());
});

test("engine factories reject malformed runtime data before constructing state", () => {
  const grid = makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]);
  const lavaSetup = {
    ...makeSetup(grid),
    grid: {
      ...grid,
      cells: [{ kind: "lava" }, grid.cells[1]],
    },
  };

  assert.throws(
    () => BattleEngine.create(
      lavaSetup as unknown as Parameters<typeof BattleEngine.create>[0],
      CONFIG,
      NO_COOLDOWN,
    ),
    /Unsupported battle cell kind: lava/,
  );
  assert.throws(
    () => BattleEngine.restore(
      {
        ...makeSnapshot(grid),
        grid: { ...grid, cells: [grid.cells[0]] },
      } as Parameters<typeof BattleEngine.restore>[0],
      NO_COOLDOWN,
    ),
    /contains 1 cells; expected 2/,
  );
});

test("restore validates cooldown and split state supplied at its boundary", () => {
  const grid = makeGrid(3, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 2, y: 0 }, occupied(BETA, 1)],
  ]);
  const base = makeSnapshot(grid);

  assert.throws(
    () => BattleEngine.restore({
      ...base,
      cooldowns: [
        { playerId: ALPHA, nextActionTick: 1 },
        { playerId: ALPHA, nextActionTick: 2 },
      ],
    }, NO_COOLDOWN),
    /Duplicate cooldown/,
  );
  assert.throws(
    () => BattleEngine.restore({
      ...base,
      cooldowns: [{ playerId: "intruder", nextActionTick: 1 }],
    }, NO_COOLDOWN),
    /not a participant/,
  );
  assert.throws(
    () => BattleEngine.restore({
      ...base,
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
        { position: { x: 0, y: 0 }, dueTick: 2, sequence: 1 },
      ],
    }, NO_COOLDOWN),
    /Duplicate pending split at/,
  );
  assert.throws(
    () => BattleEngine.restore({
      ...base,
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
        { position: { x: 2, y: 0 }, dueTick: 2, sequence: 0 },
      ],
    }, NO_COOLDOWN),
    /Duplicate pending split sequence/,
  );
  assert.throws(
    () => BattleEngine.restore({
      ...base,
      pendingSplits: [
        { position: { x: 3, y: 0 }, dueTick: 1, sequence: 0 },
      ],
    }, NO_COOLDOWN),
    /outside the grid/,
  );
});

test("engine rejects unknown command discriminants at its runtime boundary", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(2, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );
  const before = engine.getSnapshot();

  assert.throws(
    () => engine.applyCommand(
      { playerId: ALPHA },
      { kind: "lava" } as unknown as Parameters<BattleEngine["applyCommand"]>[1],
    ),
    /Unsupported battle command kind: lava/,
  );
  assert.deepEqual(engine.getSnapshot(), before);
});

test("an overflowing direct increment preserves the complete engine state", () => {
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(3, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, Number.MAX_SAFE_INTEGER)],
      [{ x: 2, y: 0 }, occupied(BETA, 1)],
    ]), {
      tick: 7,
      cooldowns: [{ playerId: BETA, nextActionTick: 7 }],
    }),
    NO_COOLDOWN,
  );
  const before = engine.getSnapshot();

  assert.throws(
    () => engine.applyCommand(
      { playerId: ALPHA },
      { kind: "incrementCell", position: { x: 0, y: 0 } },
    ),
    /positive safe integer/,
  );
  assert.deepEqual(engine.getSnapshot(), before);

  // A failure on one player does not poison later valid commands.
  assert.equal(increment(engine, BETA, 2, 0).accepted, true);
});

test("a split overflow rolls back its removed queue entry and emptied source", () => {
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(3, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, Number.MAX_SAFE_INTEGER)],
    ]), {
      cooldowns: [{ playerId: ALPHA, nextActionTick: 0 }],
      pendingSplits: [
        { position: { x: 0, y: 0 }, dueTick: 1, sequence: 8 },
      ],
    }),
    NO_COOLDOWN,
  );
  const before = engine.getSnapshot();

  assert.throws(() => engine.advanceTick(), /positive safe integer/);
  assert.deepEqual(engine.getSnapshot(), before);

  // Tick rollback leaves the engine able to process unrelated commands.
  assert.equal(increment(engine, ALPHA, 0, 0).accepted, true);
});

test("rollback restores the split scheduler's hidden next sequence cursor", () => {
  const finalSequence = Number.MAX_SAFE_INTEGER;
  const engine = BattleEngine.restore(
    makeSnapshot(makeGrid(4, 3, [
      [{ x: 1, y: 1 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(ALPHA, 2)],
      [{ x: 2, y: 1 }, occupied(BETA, 3)],
    ]), {
      pendingSplits: [{
        position: { x: 1, y: 1 },
        dueTick: 1,
        sequence: finalSequence - 1,
      }],
    }),
    NO_COOLDOWN,
  );
  const before = engine.getSnapshot();

  // The up neighbour consumes the last sequence before the captured right
  // neighbour also needs one. Its mutation and the hidden cursor must roll back.
  assert.throws(() => engine.advanceTick(), /sequence space is exhausted/);
  assert.deepEqual(engine.getSnapshot(), before);

  const result = increment(engine, ALPHA, 1, 0);
  assert.equal(eventOfKind(result.events, "splitScheduled").sequence, finalSequence);
  assert.deepEqual(
    engine.getSnapshot().pendingSplits.map(({ sequence }) => sequence),
    [finalSequence - 1, finalSequence],
  );
});

test("split sequences stop at the safe-integer boundary without overflowing", () => {
  const finalSequence = Number.MAX_SAFE_INTEGER;
  const exhausted = BattleEngine.restore(
    {
      ...makeSnapshot(makeGrid(3, 1, [
        [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
        [{ x: 2, y: 0 }, occupied(BETA, 1)],
      ]), {
        pendingSplits: [{
          position: { x: 0, y: 0 },
          dueTick: 10,
          sequence: finalSequence,
        }],
      }),
    },
    NO_COOLDOWN,
  );
  const exhaustedBefore = exhausted.getSnapshot();

  assert.throws(
    () => increment(exhausted, BETA, 2, 0),
    /sequence space is exhausted/,
  );
  assert.deepEqual(exhausted.getSnapshot(), exhaustedBefore);

  const almostExhausted = BattleEngine.restore(
    {
      ...makeSnapshot(makeGrid(4, 1, [
        [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
        [{ x: 1, y: 0 }, occupied(ALPHA, 1)],
        [{ x: 3, y: 0 }, occupied(BETA, 1)],
      ]), {
        pendingSplits: [{
          position: { x: 0, y: 0 },
          dueTick: 10,
          sequence: finalSequence - 1,
        }],
      }),
    },
    NO_COOLDOWN,
  );
  const scheduled = increment(almostExhausted, ALPHA, 1, 0);
  assert.equal(eventOfKind(scheduled.events, "splitScheduled").sequence, finalSequence);
  assert.throws(
    () => increment(almostExhausted, BETA, 3, 0),
    /sequence space is exhausted/,
  );
});

test("cooldown serialization follows participant order", () => {
  const engine = BattleEngine.restore(
    {
      ...makeSnapshot(makeGrid(3, 1, [
        [{ x: 0, y: 0 }, occupied("ä", 1)],
        [{ x: 2, y: 0 }, occupied("a", 1)],
      ])),
      players: ["ä", "z", "a"],
      cooldowns: [
        { playerId: "a", nextActionTick: 3 },
        { playerId: "ä", nextActionTick: 1 },
        { playerId: "z", nextActionTick: 2 },
      ],
    },
    NO_COOLDOWN,
  );

  assert.deepEqual(
    engine.getSnapshot().cooldowns.map(({ playerId }) => playerId),
    ["ä", "z", "a"],
  );
});

test("engine snapshots contain simulation state without a battle id", () => {
  const engine = BattleEngine.create(
    makeSetup(makeGrid(2, 1, [
      [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
      [{ x: 1, y: 0 }, occupied(BETA, 1)],
    ])),
    CONFIG,
    NO_COOLDOWN,
  );

  assert.equal("battleId" in engine.getSnapshot(), false);
  assert.equal("battleId" in engine, false);
});
