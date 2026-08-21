import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorldDelta,
  type WorldSnapshot,
} from "../src/domain/world-state.ts";
import {
  parseNetworkClientMessage,
  parseNetworkServerMessage,
  parseWorldCell,
  parseWorldDelta,
  parseWorldSnapshot,
} from "../src/protocol/validators.ts";

const alpha = "alpha";
const beta = "beta";

function makeWorldSnapshot(): WorldSnapshot {
  return {
    revision: 3,
    grid: {
      width: 2,
      height: 3,
      cells: [
        { kind: "occupied", playerId: alpha },
        { kind: "unoccupied" },
        {
          kind: "challengePending",
          challengeId: "challenge-1",
          defenderId: beta,
          participantIds: [beta, alpha],
          closesAt: 10_000,
        },
        {
          kind: "battle",
          battleId: "battle-1",
          playerIds: [alpha, beta],
        },
        {
          kind: "challengeWaiting",
          challengeId: "challenge-2",
          waitingId: 7,
          defenderId: alpha,
          participantIds: [alpha, beta],
        },
        { kind: "unoccupied" },
      ],
    },
  };
}

function makeBattleSnapshot() {
  return {
    config: { ticksPerSecond: 20, splitDelayTicks: 10 },
    tick: 0,
    status: { kind: "running" as const },
    participants: [
      { participantId: 0, status: "active" as const },
      { participantId: 1, status: "active" as const },
    ],
    grid: {
      width: 2,
      height: 1,
      cells: [
        { kind: "occupied" as const, participantId: 0, count: 1 },
        { kind: "occupied" as const, participantId: 1, count: 1 },
      ],
    },
    cooldowns: [],
    pendingSplits: [],
  };
}

test("World schemas validate every cell state and bounded unique rosters", () => {
  const snapshot = makeWorldSnapshot();
  assert.deepEqual(parseWorldSnapshot(snapshot), snapshot);
  assert.deepEqual(parseWorldCell(snapshot.grid.cells[4]), snapshot.grid.cells[4]);

  assert.throws(() => parseWorldCell({
    kind: "challengePending",
    challengeId: "challenge-1",
    defenderId: alpha,
    participantIds: [alpha, alpha],
    closesAt: 10_000,
  }));
  assert.throws(() => parseWorldCell({
    kind: "battle",
    battleId: "battle-1",
    playerIds: ["a", "b", "c", "d", "e"],
  }));
  assert.throws(() => parseWorldCell({
    kind: "occupied",
    playerId: alpha,
    runtime: {},
  }));
});

test("Waiting challenge cells require an exact shape and a positive safe integer ID", () => {
  const waiting = {
    kind: "challengeWaiting",
    challengeId: "challenge-2",
    waitingId: 7,
    defenderId: alpha,
    participantIds: [alpha, beta],
  };
  assert.deepEqual(parseWorldCell(waiting), waiting);

  for (const waitingId of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => parseWorldCell({ ...waiting, waitingId }));
  }
  for (const key of [
    "challengeId",
    "waitingId",
    "defenderId",
    "participantIds",
  ] as const) {
    const incomplete: Record<string, unknown> = { ...waiting };
    delete incomplete[key];
    assert.throws(() => parseWorldCell(incomplete));
  }
  assert.throws(() => parseWorldCell({ ...waiting, closesAt: 10_000 }));
  assert.throws(() => parseWorldCell({
    ...waiting,
    participantIds: [alpha, alpha],
  }));
});

test("World deltas apply immutably and converge on the declared revision", () => {
  const snapshot = makeWorldSnapshot();
  const delta = parseWorldDelta({
    fromRevision: 3,
    revision: 4,
    changes: [
      { position: { x: 0, y: 0 }, cell: { kind: "unoccupied" } },
      {
        position: { x: 1, y: 0 },
        cell: { kind: "occupied", playerId: beta },
      },
      {
        position: { x: 0, y: 2 },
        cell: {
          kind: "challengeWaiting",
          challengeId: "challenge-3",
          waitingId: 8,
          defenderId: beta,
          participantIds: [beta, alpha],
        },
      },
    ],
  });

  const result = applyWorldDelta(snapshot, delta);
  assert.equal(result.kind, "applied");
  if (result.kind !== "applied") return;
  assert.equal(result.snapshot.revision, 4);
  assert.deepEqual(result.snapshot.grid.cells.slice(0, 2), [
    { kind: "unoccupied" },
    { kind: "occupied", playerId: beta },
  ]);
  const projectedWaiting = result.snapshot.grid.cells[4];
  assert.deepEqual(projectedWaiting, {
    kind: "challengeWaiting",
    challengeId: "challenge-3",
    waitingId: 8,
    defenderId: beta,
    participantIds: [beta, alpha],
  });
  const deltaWaiting = delta.changes[2]?.cell;
  assert.equal(projectedWaiting?.kind, "challengeWaiting");
  assert.equal(deltaWaiting?.kind, "challengeWaiting");
  if (projectedWaiting?.kind !== "challengeWaiting") return;
  if (deltaWaiting?.kind !== "challengeWaiting") return;
  assert.notEqual(projectedWaiting.participantIds, deltaWaiting.participantIds);
  assert.deepEqual(snapshot, makeWorldSnapshot());
  assert.notEqual(result.snapshot.grid.cells, snapshot.grid.cells);
});

test("World delta revision gaps are recoverable resync signals", () => {
  const result = applyWorldDelta(makeWorldSnapshot(), {
    fromRevision: 2,
    revision: 3,
    changes: [],
  });

  assert.deepEqual(result, {
    kind: "revisionGap",
    expectedRevision: 3,
    receivedFromRevision: 2,
  });
});

test("World delta application rejects inconsistent authoritative batches", () => {
  const snapshot = makeWorldSnapshot();
  assert.throws(() => applyWorldDelta(snapshot, {
    fromRevision: 3,
    revision: 3,
    changes: [],
  }), /advance/);
  assert.throws(() => applyWorldDelta(snapshot, {
    fromRevision: 3,
    revision: 4,
    changes: [
      { position: { x: 2, y: 0 }, cell: { kind: "unoccupied" } },
    ],
  }), /out of bounds/);
  assert.throws(() => applyWorldDelta(snapshot, {
    fromRevision: 3,
    revision: 4,
    changes: [
      { position: { x: 1, y: 1 }, cell: { kind: "unoccupied" } },
      { position: { x: 1, y: 1 }, cell: { kind: "occupied", playerId: alpha } },
    ],
  }), /duplicate position/);
});

test("network protocol parses World commands and rejects unknown payload fields", () => {
  const messages = [
    {
      type: "challengeWorldCell",
      requestId: "request-1",
      position: { x: 2, y: 3 },
    },
    {
      type: "joinWorldChallenge",
      requestId: "request-2",
      challengeId: "challenge-1",
    },
    {
      type: "leaveWorldChallenge",
      requestId: "request-3",
      challengeId: "challenge-1",
    },
    { type: "requestWorldSnapshot" },
    { type: "leaveBattle", battleId: "battle-1" },
    {
      type: "leaveBattle",
      battleId: "battle-1",
      requestId: "request-4",
    },
  ];
  for (const message of messages) {
    assert.deepEqual(parseNetworkClientMessage(message), message);
  }
  assert.throws(() => parseNetworkClientMessage({
    ...messages[0],
    consent: true,
  }));
});

test("network protocol parses snapshots, deltas, command results, and joined rosters", () => {
  const snapshot = makeWorldSnapshot();
  const messages = [
    { type: "worldSnapshot", challengeable: true, snapshot },
    {
      type: "worldDelta",
      challengeable: false,
      fromRevision: 3,
      revision: 4,
      changes: [{
        position: { x: 0, y: 0 },
        cell: {
          kind: "challengeWaiting",
          challengeId: "challenge-3",
          waitingId: 8,
          defenderId: beta,
          participantIds: [beta, alpha],
        },
      }],
    },
    { type: "worldCommandAccepted", requestId: "request-1" },
    {
      type: "worldCommandRejected",
      requestId: "request-2",
      reason: "selfChallenge",
    },
    {
      type: "battleJoined",
      battleId: "battle-1",
      worldPosition: { x: 1, y: 1 },
      localParticipantId: 0,
      roster: [
        { participantId: 0, playerId: alpha, status: "active" },
        { participantId: 1, playerId: beta, status: "active" },
      ],
      snapshot: makeBattleSnapshot(),
    },
  ];

  for (const message of messages) {
    assert.deepEqual(parseNetworkServerMessage(message), message);
  }
  assert.throws(() => parseNetworkServerMessage({
    type: "worldSnapshot",
    snapshot,
  }));
  assert.throws(() => parseNetworkServerMessage({
    type: "worldDelta",
    challengeable: "yes",
    fromRevision: 3,
    revision: 4,
    changes: [],
  }));

  assert.deepEqual(parseNetworkServerMessage({
    ...messages.at(-1),
    worldPosition: null,
  }), {
    ...messages.at(-1),
    worldPosition: null,
  });
  assert.throws(() => parseNetworkServerMessage({
    ...messages.at(-1),
    createRequestId: "debug-create-1",
  }));
});

test("World command rejections use the complete stable reason set", () => {
  const reasons = [
    "invalidTarget",
    "selfChallenge",
    "unknownChallenge",
    "challengeClosed",
    "alreadyJoined",
    "challengeFull",
    "notParticipant",
    "battleLimitReached",
  ];
  for (const reason of reasons) {
    const message = {
      type: "worldCommandRejected",
      requestId: `request-${reason}`,
      reason,
    };
    assert.deepEqual(parseNetworkServerMessage(message), message);
  }
  assert.throws(() => parseNetworkServerMessage({
    type: "worldCommandRejected",
    requestId: "request-nope",
    reason: "nope",
  }));
});
