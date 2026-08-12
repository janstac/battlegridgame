import assert from "node:assert/strict";
import test from "node:test";

import {
  PendingChallenge,
  type PendingChallengeClock,
  type PendingChallengeEvent,
} from "../src/world/PendingChallenge.ts";

class FakeClock implements PendingChallengeClock {
  currentTime = 1_000;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number { return this.currentTime; }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentTime + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advanceTo(target: number): void {
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.currentTime = due[1].at;
      due[1].callback();
    }
    this.currentTime = target;
  }

  takeOnlyCallback(): () => void {
    assert.equal(this.timers.size, 1);
    const entry = [...this.timers.entries()][0]!;
    this.timers.delete(entry[0]);
    return entry[1].callback;
  }
}

function createChallenge(
  connected = new Set(["defender", "challenger", "third", "fourth", "fifth"]),
) {
  const clock = new FakeClock();
  const events: PendingChallengeEvent[] = [];
  const challenge = new PendingChallenge({
    challengeId: "challenge-1",
    position: { x: 2, y: 3 },
    defenderId: "defender",
    challengerId: "challenger",
    isPlayerConnected: (playerId) => connected.has(playerId),
    clock,
    onEvent: (event) => events.push(event),
  });
  return { challenge, clock, events, connected };
}

test("starts with defender and challenger and expires the finalized ordered roster", () => {
  const { challenge, clock, events } = createChallenge();
  assert.deepEqual(challenge.snapshot(), {
    challengeId: "challenge-1",
    position: { x: 2, y: 3 },
    defenderId: "defender",
    participantIds: ["defender", "challenger"],
    closesAt: 11_000,
  });

  assert.deepEqual(challenge.join("third"), { accepted: true });
  assert.deepEqual(challenge.join("fourth"), { accepted: true });
  assert.deepEqual(challenge.join("third"), {
    accepted: false,
    reason: "alreadyJoined",
  });
  assert.deepEqual(challenge.join("fifth"), {
    accepted: false,
    reason: "challengeFull",
  });

  clock.advanceTo(11_000);
  assert.equal(challenge.status, "expired");
  assert.equal(events.at(-1)?.kind, "expired");
  assert.deepEqual(events.at(-1)?.challenge.participantIds, [
    "defender", "challenger", "third", "fourth",
  ]);
});

test("an action at the exact deadline loses the serialized race", () => {
  const { challenge, clock, events } = createChallenge();
  clock.currentTime = 11_000;

  assert.deepEqual(challenge.join("third"), {
    accepted: false,
    reason: "challengeClosed",
  });
  assert.equal(challenge.status, "expired");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "expired");

  // The now-stale timer is harmless.
  clock.advanceTo(11_000);
  assert.equal(events.length, 1);
});

test("leaving removes only that participant and cancels below two", () => {
  const { challenge, events } = createChallenge();
  challenge.join("third");

  assert.deepEqual(challenge.leave("challenger"), { accepted: true });
  assert.deepEqual(challenge.participantIds, ["defender", "third"]);
  assert.equal(events.at(-1)?.kind, "rosterChanged");

  assert.deepEqual(challenge.leave("third"), { accepted: true });
  const cancellation = events.at(-1);
  assert.equal(cancellation?.kind, "cancelled");
  if (cancellation?.kind === "cancelled") {
    assert.equal(cancellation.reason, "insufficientParticipants");
    assert.deepEqual(cancellation.replacementCell, {
      kind: "occupied",
      playerId: "defender",
    });
  }
  assert.equal(challenge.status, "cancelled");
  assert.deepEqual(challenge.join("fourth"), {
    accepted: false,
    reason: "challengeClosed",
  });
});

test("an explicitly departed but connected defender remains the restoration target", () => {
  const { challenge, events } = createChallenge();
  challenge.join("third");
  challenge.leave("defender");
  assert.deepEqual(challenge.participantIds, ["challenger", "third"]);

  challenge.leave("third");
  const event = events.at(-1);
  assert.equal(event?.kind, "cancelled");
  if (event?.kind === "cancelled") {
    assert.deepEqual(event.replacementCell, {
      kind: "occupied",
      playerId: "defender",
    });
  }
});

test("defender disconnect immediately cancels to unoccupied", () => {
  const { challenge, events, connected } = createChallenge();
  challenge.join("third");
  connected.delete("defender");
  challenge.disconnect("defender");

  const event = events.at(-1);
  assert.equal(event?.kind, "cancelled");
  if (event?.kind === "cancelled") {
    assert.equal(event.reason, "defenderDisconnected");
    assert.deepEqual(event.replacementCell, { kind: "unoccupied" });
  }
});

test("defender disconnect wins over expiry when processed at the deadline", () => {
  const { challenge, clock, events, connected } = createChallenge();
  clock.currentTime = challenge.closesAt;
  connected.delete("defender");

  challenge.disconnect("defender");

  const event = events.at(-1);
  assert.equal(event?.kind, "cancelled");
  if (event?.kind === "cancelled") {
    assert.equal(event.reason, "defenderDisconnected");
    assert.deepEqual(event.replacementCell, { kind: "unoccupied" });
  }
});

test("challenger disconnect cancellation restores only a connected defender", () => {
  const { challenge, events, connected } = createChallenge();
  connected.delete("defender");
  challenge.disconnect("challenger");

  const event = events.at(-1);
  assert.equal(event?.kind, "cancelled");
  if (event?.kind === "cancelled") {
    assert.equal(event.reason, "insufficientParticipants");
    assert.deepEqual(event.replacementCell, { kind: "unoccupied" });
  }
});

test("dispose and cancelled challenges ignore stale timer callbacks", () => {
  const first = createChallenge();
  const staleAfterDispose = first.clock.takeOnlyCallback();
  first.challenge.dispose();
  staleAfterDispose();
  assert.equal(first.challenge.status, "disposed");
  assert.equal(first.events.length, 0);

  const second = createChallenge();
  const staleAfterCancel = second.clock.takeOnlyCallback();
  second.challenge.leave("challenger");
  const count = second.events.length;
  staleAfterCancel();
  assert.equal(second.events.length, count);
});

test("constructor rejects self-challenges and invalid durations", () => {
  const clock = new FakeClock();
  const base = {
    challengeId: "challenge-1",
    position: { x: 0, y: 0 },
    defenderId: "same",
    challengerId: "same",
    isPlayerConnected: () => true,
    clock,
  };
  assert.throws(() => new PendingChallenge(base), /own World cell/);
  assert.throws(() => new PendingChallenge({
    ...base,
    challengerId: "different",
    durationMs: 0,
  }), /positive safe integer/);
});
