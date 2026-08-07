import assert from "node:assert/strict";
import test from "node:test";

import {
  isClientMessage,
  isServerMessage,
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
    assert.equal(isServerMessage(message), true);
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
    assert.equal(isServerMessage(message), false);
    assert.throws(() => parseServerMessage(message));
  }
});
