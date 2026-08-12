import type {
  ChallengeId,
  ChallengePendingWorldCell,
  PlayerId,
  Position,
  UnixTimestampMs,
} from "@grid-game/shared";

export const DEFAULT_CHALLENGE_DURATION_MS = 10_000;
export const MAX_CHALLENGE_PARTICIPANTS = 4;

export interface PendingChallengeClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CLOCK: PendingChallengeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as NodeJS.Timeout),
};

export type PendingChallengeStatus =
  | "pending"
  | "expired"
  | "cancelled"
  | "disposed";

export type PendingChallengeSnapshot = Readonly<{
  challengeId: ChallengeId;
  position: Position;
  defenderId: PlayerId;
  participantIds: readonly PlayerId[];
  closesAt: UnixTimestampMs;
}>;

export type PendingChallengeCancellationCell =
  | Readonly<{ kind: "unoccupied" }>
  | Readonly<{ kind: "occupied"; playerId: PlayerId }>;

export type PendingChallengeEvent =
  | Readonly<{
      kind: "rosterChanged";
      challenge: PendingChallengeSnapshot;
    }>
  | Readonly<{
      kind: "expired";
      challenge: PendingChallengeSnapshot;
    }>
  | Readonly<{
      kind: "cancelled";
      challenge: PendingChallengeSnapshot;
      reason: "insufficientParticipants" | "defenderDisconnected";
      replacementCell: PendingChallengeCancellationCell;
    }>;

export type PendingChallengeJoinResult =
  | Readonly<{ accepted: true }>
  | Readonly<{
      accepted: false;
      reason: "challengeClosed" | "alreadyJoined" | "challengeFull";
    }>;

export type PendingChallengeLeaveResult =
  | Readonly<{ accepted: true }>
  | Readonly<{
      accepted: false;
      reason: "challengeClosed" | "notParticipant";
    }>;

export interface PendingChallengeOptions {
  challengeId: ChallengeId;
  position: Position;
  defenderId: PlayerId;
  challengerId: PlayerId;
  isPlayerConnected: (playerId: PlayerId) => boolean;
  clock?: PendingChallengeClock;
  durationMs?: number;
  onEvent?: (event: PendingChallengeEvent) => void;
}

/**
 * Owns one pending challenge roster and authoritative deadline.
 *
 * Every public operation is synchronous, so calls and the timer callback are
 * totally ordered by JavaScript run-to-completion. Each operation first closes
 * an overdue roster, giving an action racing the deadline one deterministic
 * result. The World cell remains plain data and is updated by an event listener.
 */
export class PendingChallenge {
  readonly challengeId: ChallengeId;
  readonly position: Position;
  readonly defenderId: PlayerId;
  readonly closesAt: UnixTimestampMs;

  private readonly clock: PendingChallengeClock;
  private readonly isPlayerConnected: (playerId: PlayerId) => boolean;
  private readonly listeners = new Set<(event: PendingChallengeEvent) => void>();
  private readonly members: PlayerId[];
  private phase: PendingChallengeStatus = "pending";
  private timer: unknown | undefined;
  private emitting = false;

  constructor(options: PendingChallengeOptions) {
    assertNonEmptyId(options.challengeId, "challengeId");
    assertNonEmptyId(options.defenderId, "defenderId");
    assertNonEmptyId(options.challengerId, "challengerId");
    if (options.defenderId === options.challengerId) {
      throw new Error("A player cannot challenge their own World cell");
    }
    assertPosition(options.position);

    const durationMs = options.durationMs ?? DEFAULT_CHALLENGE_DURATION_MS;
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new RangeError("Challenge duration must be a positive safe integer");
    }
    this.clock = options.clock ?? SYSTEM_CLOCK;
    const now = this.clock.now();
    assertTimestamp(now, "PendingChallengeClock.now()");
    if (now > Number.MAX_SAFE_INTEGER - durationMs) {
      throw new RangeError("Challenge deadline exceeds the safe integer range");
    }

    this.challengeId = options.challengeId;
    this.position = { ...options.position };
    this.defenderId = options.defenderId;
    this.members = [options.defenderId, options.challengerId];
    this.closesAt = now + durationMs;
    this.isPlayerConnected = options.isPlayerConnected;
    if (options.onEvent !== undefined) this.listeners.add(options.onEvent);
    this.scheduleTimer(durationMs);
  }

  get status(): PendingChallengeStatus { return this.phase; }

  get participantIds(): readonly PlayerId[] { return [...this.members]; }

  snapshot(): PendingChallengeSnapshot {
    return {
      challengeId: this.challengeId,
      position: { ...this.position },
      defenderId: this.defenderId,
      participantIds: [...this.members],
      closesAt: this.closesAt,
    };
  }

  /** The serializable World cell matching the current open roster. */
  worldCell(): ChallengePendingWorldCell {
    const snapshot = this.snapshot();
    return {
      kind: "challengePending",
      challengeId: snapshot.challengeId,
      defenderId: snapshot.defenderId,
      participantIds: [...snapshot.participantIds],
      closesAt: snapshot.closesAt,
    };
  }

  subscribe(listener: (event: PendingChallengeEvent) => void): () => void {
    this.assertNotDisposed();
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  join(playerId: PlayerId): PendingChallengeJoinResult {
    this.assertNotReentrant();
    if (this.closeIfDue() || this.phase !== "pending") {
      return { accepted: false, reason: "challengeClosed" };
    }
    if (this.members.includes(playerId)) {
      return { accepted: false, reason: "alreadyJoined" };
    }
    if (this.members.length >= MAX_CHALLENGE_PARTICIPANTS) {
      return { accepted: false, reason: "challengeFull" };
    }
    this.members.push(playerId);
    this.emit({ kind: "rosterChanged", challenge: this.snapshot() });
    return { accepted: true };
  }

  leave(playerId: PlayerId): PendingChallengeLeaveResult {
    this.assertNotReentrant();
    if (this.closeIfDue() || this.phase !== "pending") {
      return { accepted: false, reason: "challengeClosed" };
    }
    const index = this.members.indexOf(playerId);
    if (index < 0) return { accepted: false, reason: "notParticipant" };

    this.members.splice(index, 1);
    this.afterMemberRemoved();
    return { accepted: true };
  }

  /** Applies connection loss; defender loss always cancels to unoccupied. */
  disconnect(playerId: PlayerId): void {
    this.assertNotReentrant();
    if (this.phase !== "pending") return;
    if (playerId === this.defenderId) {
      const index = this.members.indexOf(playerId);
      if (index >= 0) this.members.splice(index, 1);
      this.cancel("defenderDisconnected", { kind: "unoccupied" });
      return;
    }
    if (this.closeIfDue() || this.phase !== "pending") return;

    const index = this.members.indexOf(playerId);
    if (index < 0) return;
    this.members.splice(index, 1);
    this.afterMemberRemoved();
  }

  /** Explicitly closes an overdue roster; useful for deterministic coordinators/tests. */
  expireIfDue(): boolean {
    this.assertNotReentrant();
    return this.closeIfDue();
  }

  /** Stops the deadline and event delivery without producing an outcome. */
  dispose(): void {
    if (this.phase === "disposed") return;
    this.clearTimer();
    this.phase = "disposed";
    this.listeners.clear();
  }

  private afterMemberRemoved(): void {
    if (this.members.length >= 2) {
      this.emit({ kind: "rosterChanged", challenge: this.snapshot() });
      return;
    }
    const replacementCell: PendingChallengeCancellationCell =
      this.isPlayerConnected(this.defenderId)
        ? { kind: "occupied", playerId: this.defenderId }
        : { kind: "unoccupied" };
    this.cancel("insufficientParticipants", replacementCell);
  }

  private closeIfDue(): boolean {
    if (this.phase !== "pending") return false;
    const now = this.clock.now();
    assertTimestamp(now, "PendingChallengeClock.now()");
    if (now < this.closesAt) return false;
    this.clearTimer();
    this.phase = "expired";
    this.emit({ kind: "expired", challenge: this.snapshot() });
    return true;
  }

  private cancel(
    reason: "insufficientParticipants" | "defenderDisconnected",
    replacementCell: PendingChallengeCancellationCell,
  ): void {
    this.clearTimer();
    this.phase = "cancelled";
    this.emit({
      kind: "cancelled",
      challenge: this.snapshot(),
      reason,
      replacementCell,
    });
  }

  private scheduleTimer(delayMs: number): void {
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      if (this.phase !== "pending") return;
      if (!this.closeIfDue()) {
        this.scheduleTimer(this.closesAt - this.clock.now());
      }
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private emit(event: PendingChallengeEvent): void {
    this.emitting = true;
    try {
      for (const listener of [...this.listeners]) listener(copyEvent(event));
    } finally {
      this.emitting = false;
    }
  }

  private assertNotDisposed(): void {
    if (this.phase === "disposed") throw new Error("PendingChallenge has been disposed");
  }

  private assertNotReentrant(): void {
    this.assertNotDisposed();
    if (this.emitting) {
      throw new Error("PendingChallenge operations cannot be called from an event listener");
    }
  }
}

function assertNonEmptyId(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty`);
}

function assertPosition(position: Position): void {
  if (
    !Number.isSafeInteger(position.x)
    || !Number.isSafeInteger(position.y)
    || position.x < 0
    || position.y < 0
  ) {
    throw new RangeError("Challenge position must contain non-negative safe integers");
  }
}

function assertTimestamp(value: number, source: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${source} must return a non-negative safe integer`);
  }
}

function copyEvent(event: PendingChallengeEvent): PendingChallengeEvent {
  const challenge: PendingChallengeSnapshot = {
    ...event.challenge,
    position: { ...event.challenge.position },
    participantIds: [...event.challenge.participantIds],
  };
  if (event.kind === "cancelled") {
    return {
      kind: event.kind,
      challenge,
      reason: event.reason,
      replacementCell: { ...event.replacementCell },
    };
  }
  return { kind: event.kind, challenge };
}
