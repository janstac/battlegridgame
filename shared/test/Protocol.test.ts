import assert from "node:assert/strict";
import test from "node:test";

import {
  isClientMessage,
  parseClientMessage,
  parseServerMessage,
} from "../src/protocol/index.ts";
import { ALPHA, BETA, makeGrid, makeSnapshot, occupied } from "./helpers.ts";

test("client protocol accepts a complete increment message", () => {
  const message = {
    type: "incrementCell",
    requestId: "request-1",
    battleId: "battle-1",
    position: { x: 2, y: 3 },
  };

  assert.equal(isClientMessage(message), true);
  assert.deepEqual(parseClientMessage(message), message);
});

test("client protocol rejects malformed and excessive messages", () => {
  const invalid = [
    null,
    {},
    { type: "incrementCell", requestId: "", battleId: "battle-1", position: { x: 0, y: 0 } },
    { type: "incrementCell", requestId: "r", battleId: "battle-1", position: { x: -1, y: 0 } },
    {
      type: "incrementCell",
      requestId: "r",
      battleId: "battle-1",
      position: { x: 0, y: 0 },
      unexpected: true,
    },
  ];

  for (const message of invalid) {
    assert.equal(isClientMessage(message), false);
    assert.throws(() => parseClientMessage(message));
  }
});

test("server protocol validates snapshots, accepted commands, and advances", () => {
  const snapshot = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]), { battleId: "battle-1" });
  const messages = [
    { type: "battleSnapshot", snapshot },
    {
      type: "commandAccepted",
      requestId: "request-1",
      events: [
        {
          kind: "cellIncremented",
          position: { x: 0, y: 0 },
          playerId: ALPHA,
          previousCount: 1,
          nextCount: 2,
          source: "command",
        },
      ],
      snapshot,
    },
    { type: "battleAdvanced", events: [], snapshot },
    {
      type: "commandRejected",
      requestId: "request-2",
      battleId: "battle-1",
      reason: "notOwner",
    },
  ];

  for (const message of messages) {
    assert.deepEqual(parseServerMessage(message), message);
  }
});

test("server protocol rejects malformed nested state and events", () => {
  const snapshot = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]));
  const invalid = [
    { type: "battleAdvanced", events: [], snapshot: { ...snapshot, tick: -1 } },
    {
      type: "commandAccepted",
      requestId: "request-1",
      events: [{ kind: "battleWon", winnerId: "" }],
      snapshot,
    },
    {
      type: "commandRejected",
      requestId: "request-2",
      battleId: "test-battle",
      reason: "madeUpReason",
    },
  ];

  for (const message of invalid) {
    assert.throws(() => parseServerMessage(message));
  }
});

test("server protocol rejects snapshots that violate semantic invariants", () => {
  const base = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]));
  const oneOwner = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(ALPHA, 1)],
  ]));
  const pending = [
    { position: { x: 0, y: 0 }, dueTick: 1, sequence: 0 },
  ];

  const invalidSnapshots: Array<readonly [string, unknown]> = [
    ["grid cell count", { ...base, grid: { ...base.grid, cells: [base.grid.cells[0]] } }],
    ["duplicate players", { ...base, players: [ALPHA, ALPHA] }],
    [
      "duplicate cooldown owners",
      {
        ...base,
        cooldowns: [
          { playerId: ALPHA, nextActionTick: 1 },
          { playerId: ALPHA, nextActionTick: 2 },
        ],
      },
    ],
    [
      "duplicate pending positions",
      {
        ...base,
        pendingSplits: [
          ...pending,
          { position: { x: 0, y: 0 }, dueTick: 2, sequence: 1 },
        ],
      },
    ],
    [
      "duplicate pending sequences",
      {
        ...base,
        pendingSplits: [
          ...pending,
          { position: { x: 1, y: 0 }, dueTick: 2, sequence: 0 },
        ],
      },
    ],
    [
      "out-of-bounds pending position",
      {
        ...base,
        pendingSplits: [
          { position: { x: 2, y: 0 }, dueTick: 1, sequence: 0 },
        ],
      },
    ],
    [
      "nonparticipant cell owner",
      {
        ...base,
        grid: {
          ...base.grid,
          cells: [occupied("intruder", 1), base.grid.cells[1]],
        },
      },
    ],
    [
      "nonparticipant cooldown owner",
      {
        ...base,
        cooldowns: [{ playerId: "intruder", nextActionTick: 1 }],
      },
    ],
    ["running ownership", oneOwner],
    [
      "isolated traversable cells",
      makeSnapshot(makeGrid(2, 2, [
        [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
        [{ x: 1, y: 0 }, { kind: "wall" }],
        [{ x: 0, y: 1 }, { kind: "wall" }],
        [{ x: 1, y: 1 }, occupied(BETA, 1)],
      ])),
    ],
    [
      "finished winner ownership",
      { ...oneOwner, status: { kind: "finished", winnerId: BETA } },
    ],
    [
      "finished pending work",
      {
        ...oneOwner,
        status: { kind: "finished", winnerId: ALPHA },
        pendingSplits: pending,
      },
    ],
    ["unsafe tick", { ...base, tick: Number.MAX_SAFE_INTEGER + 1 }],
  ];

  for (const [name, snapshot] of invalidSnapshots) {
    const message = { type: "battleSnapshot", snapshot };
    assert.throws(
      () => parseServerMessage(message),
      name,
    );
  }
});

test("protocol rejects unsafe event integers and client coordinates", () => {
  const snapshot = makeSnapshot(makeGrid(2, 1, [
    [{ x: 0, y: 0 }, occupied(ALPHA, 1)],
    [{ x: 1, y: 0 }, occupied(BETA, 1)],
  ]));
  const unsafe = Number.MAX_SAFE_INTEGER + 1;

  assert.equal(isClientMessage({
    type: "incrementCell",
    requestId: "request-unsafe",
    battleId: "test-battle",
    position: { x: unsafe, y: 0 },
  }), false);
  assert.equal({
    type: "battleAdvanced",
    events: [{
      kind: "cellIncremented",
      position: { x: 0, y: 0 },
      playerId: ALPHA,
      previousCount: 1,
      nextCount: unsafe,
      source: "command",
    }],
    snapshot,
  }, false);
});
