import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminNetworkClientMessageValidator,
  parseAdminConnectionServerMessage,
  parseAdminNetworkClientMessage,
  parseAdminNetworkServerMessage,
  parseAnonymousNetworkClientMessage,
  parseConnectedAsAdminMessage,
  parseNetworkClientMessage,
  type WorldSnapshot,
} from "../src/index.ts";

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

function makeAdminBattle() {
  return {
    battleId: "battle-1",
    worldPosition: null,
    roster: [
      { participantId: 0, playerId: alpha, status: "active" as const },
      { participantId: 1, playerId: beta, status: "active" as const },
    ],
    snapshot: makeBattleSnapshot(),
  };
}

test("anonymous clients must select exactly one connection role", () => {
  assert.deepEqual(
    parseAnonymousNetworkClientMessage({ type: "connectAsPlayer" }),
    { type: "connectAsPlayer" },
  );
  assert.deepEqual(
    parseAnonymousNetworkClientMessage({
      type: "connectAsAdmin",
      token: "temporary-secret",
    }),
    { type: "connectAsAdmin", token: "temporary-secret" },
  );

  assert.throws(() =>
    parseAnonymousNetworkClientMessage({ type: "connectAsAdmin" }),
  );
  assert.throws(() =>
    parseAnonymousNetworkClientMessage({
      type: "connectAsPlayer",
      token: "not-allowed",
    }),
  );
  assert.throws(() =>
    parseAnonymousNetworkClientMessage({
      type: "adminListPlayers",
      requestId: "request-1",
    }),
  );
  assert.throws(() =>
    parseNetworkClientMessage({ type: "connectAsPlayer" }),
  );
});

test("admin requests are strict, correlated, and role-specific", () => {
  const snapshot = makeWorldSnapshot();
  const messages = [
    { type: "adminListPlayers", requestId: "request-1" },
    { type: "adminGetWorld", requestId: "request-2" },
    { type: "adminListBattles", requestId: "request-3" },
    {
      type: "adminStartBattle",
      requestId: "request-4",
      playerIds: [alpha, beta],
    },
    {
      type: "adminReplaceWorldCells",
      requestId: "request-5",
      changes: [
        {
          position: { x: 0, y: 0 },
          expected: snapshot.grid.cells[0],
          next: { kind: "unoccupied" },
        },
        {
          position: { x: 0, y: 1 },
          expected: snapshot.grid.cells[2],
          next: { kind: "occupied", playerId: beta },
        },
        {
          position: { x: 1, y: 1 },
          expected: snapshot.grid.cells[3],
          next: { kind: "unoccupied" },
        },
        {
          position: { x: 0, y: 2 },
          expected: snapshot.grid.cells[4],
          next: { kind: "occupied", playerId: alpha },
        },
      ],
    },
  ];

  for (const message of messages) {
    assert.deepEqual(parseAdminNetworkClientMessage(message), message);
  }

  assert.throws(() =>
    parseAdminNetworkClientMessage({ type: "adminListPlayers" }),
  );
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminListPlayers",
      requestId: "request-1",
      extra: true,
    }),
  );
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "connectAsAdmin",
      token: "temporary-secret",
    }),
  );
  for (const playerIds of [
    [alpha],
    [alpha, beta, "gamma", "delta", "epsilon"],
    [alpha, alpha],
    [alpha, ""],
  ]) {
    assert.throws(() =>
      parseAdminNetworkClientMessage({
        type: "adminStartBattle",
        requestId: "invalid-roster",
        playerIds,
      }),
    );
  }
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminListPlayers",
      requestId: "",
    }),
  );
});

test("admin world replacements require a bounded unique-coordinate batch", () => {
  const snapshot = makeWorldSnapshot();
  const replacement = {
    position: { x: 0, y: 0 },
    expected: snapshot.grid.cells[0],
    next: { kind: "unoccupied" },
  };

  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "empty",
      changes: [],
    }),
  );

  const tooMany = Array.from({ length: 257 }, (_, x) => ({
    ...replacement,
    position: { x, y: 0 },
  }));
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "too-many",
      changes: tooMany,
    }),
  );

  const duplicatePosition = {
    type: "adminReplaceWorldCells",
    requestId: "duplicate",
    changes: [
      replacement,
      {
        ...replacement,
        expected: { kind: "unoccupied" },
        next: { kind: "occupied", playerId: beta },
      },
    ],
  };
  assert.equal(
    AdminNetworkClientMessageValidator.Check(duplicatePosition),
    false,
  );
  assert.throws(() => parseAdminNetworkClientMessage(duplicatePosition));
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "invalid-position",
      changes: [{ ...replacement, position: { x: -1, y: 0 } }],
    }),
  );
  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "invalid-next",
      changes: [
        {
          ...replacement,
          next: { kind: "unoccupied", playerId: alpha },
        },
      ],
    }),
  );
});

test("admin world replacements accept full lifecycle expectations only", () => {
  const snapshot = makeWorldSnapshot();

  for (const expected of [
    snapshot.grid.cells[2],
    snapshot.grid.cells[3],
    snapshot.grid.cells[4],
  ]) {
    assert.doesNotThrow(() =>
      parseAdminNetworkClientMessage({
        type: "adminReplaceWorldCells",
        requestId: "lifecycle-expected",
        changes: [
          {
            position: { x: 0, y: 1 },
            expected,
            next: { kind: "unoccupied" },
          },
        ],
      }),
    );
  }

  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "partial-expected",
      changes: [
        {
          position: { x: 0, y: 1 },
          expected: { kind: "challengePending", challengeId: "challenge-1" },
          next: { kind: "unoccupied" },
        },
      ],
    }),
  );

  assert.throws(() =>
    parseAdminNetworkClientMessage({
      type: "adminReplaceWorldCells",
      requestId: "partial-waiting-expected",
      changes: [
        {
          position: { x: 0, y: 2 },
          expected: {
            kind: "challengeWaiting",
            challengeId: "challenge-2",
            waitingId: 7,
          },
          next: { kind: "unoccupied" },
        },
      ],
    }),
  );

  for (const next of [
    snapshot.grid.cells[2],
    snapshot.grid.cells[3],
    snapshot.grid.cells[4],
  ]) {
    assert.throws(() =>
      parseAdminNetworkClientMessage({
        type: "adminReplaceWorldCells",
        requestId: "lifecycle-next",
        changes: [
          {
            position: { x: 0, y: 1 },
            expected: { kind: "unoccupied" },
            next,
          },
        ],
      }),
    );
  }
});

test("admin connection and correlated response messages validate separately", () => {
  assert.deepEqual(
    parseConnectedAsAdminMessage({ type: "connectedAsAdmin" }),
    { type: "connectedAsAdmin" },
  );
  assert.deepEqual(
    parseAdminConnectionServerMessage({ type: "connectedAsAdmin" }),
    { type: "connectedAsAdmin" },
  );
  assert.throws(() =>
    parseAdminNetworkServerMessage({ type: "connectedAsAdmin" }),
  );
  assert.throws(() =>
    parseConnectedAsAdminMessage({ type: "connectedAsAdmin", extra: true }),
  );

  const snapshot = makeWorldSnapshot();
  const battle = makeAdminBattle();
  const responses = [
    { type: "adminPlayers", requestId: "request-1", playerIds: [alpha, beta] },
    { type: "adminWorld", requestId: "request-2", snapshot },
    { type: "adminBattles", requestId: "request-3", battles: [battle] },
    { type: "adminBattleStarted", requestId: "request-4", battle },
    {
      type: "adminWorldCellsReplaced",
      requestId: "request-5",
      revision: 4,
      changes: [
        {
          position: { x: 0, y: 0 },
          cell: { kind: "unoccupied" },
        },
      ],
    },
    {
      type: "adminError",
      requestId: "request-6",
      code: "conflict",
      message: "The expected world cell is stale.",
    },
  ];

  for (const response of responses) {
    assert.deepEqual(parseAdminNetworkServerMessage(response), response);
    assert.deepEqual(parseAdminConnectionServerMessage(response), response);
  }
});

test("admin response schemas reject local-player fields and unstable errors", () => {
  for (const code of [
    "invalidRequest",
    "unknownPlayer",
    "invalidRoster",
    "conflict",
    "lifecycleNotFound",
    "lifecycleCancellationFailed",
    "battleLimitReached",
    "internal",
  ]) {
    assert.doesNotThrow(() =>
      parseAdminNetworkServerMessage({
        type: "adminError",
        requestId: "request-code",
        code,
        message: "A stable admin error.",
      }),
    );
  }

  assert.throws(() =>
    parseAdminNetworkServerMessage({
      type: "adminBattleStarted",
      requestId: "request-1",
      battle: {
        ...makeAdminBattle(),
        localParticipantId: 0,
      },
    }),
  );
  assert.throws(() =>
    parseAdminNetworkServerMessage({
      type: "adminError",
      requestId: "request-2",
      code: "somethingUnexpected",
      message: "Nope",
    }),
  );
  assert.throws(() =>
    parseAdminNetworkServerMessage({
      type: "adminPlayers",
      requestId: "",
      playerIds: [],
    }),
  );
});
