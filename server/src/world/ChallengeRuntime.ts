import type {
  ChallengeId,
  ChallengePendingWorldCell,
  ChallengeWaitingWorldCell,
  PlayerId,
  Position,
  UnixTimestampMs,
  WaitingId,
} from "@grid-game/shared";
import {
  DEFAULT_CHALLENGE_DURATION_MS,
  MAX_CHALLENGE_PARTICIPANTS,
  type PendingChallengeClock,
} from "./PendingChallenge.ts";

const SYSTEM_CLOCK: PendingChallengeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as NodeJS.Timeout),
};

export type ChallengeRuntimePhase =
  | "waiting"
  | "countdown"
  | "expired"
  | "cancelled"
  | "disposed";

export type ChallengeCancellation = Readonly<{
  reason: "insufficientParticipants" | "defenderDisconnected";
  replacementCell:
    | Readonly<{ kind: "unoccupied" }>
    | Readonly<{ kind: "occupied"; playerId: PlayerId }>;
}>;

export type ChallengeRosterResult =
  | Readonly<{
      accepted: false;
      reason: "challengeClosed" | "alreadyJoined" | "challengeFull" | "notParticipant";
    }>
  | Readonly<{
      accepted: true;
      removedPlayerId?: PlayerId;
      cancellation?: ChallengeCancellation;
    }>;

export type ChallengeRuntimeOptions = Readonly<{
  challengeId: ChallengeId;
  position: Position;
  defenderId: PlayerId;
  challengerId: PlayerId;
  waitingId?: WaitingId;
  isPlayerConnected(playerId: PlayerId): boolean;
  onExpired(challengeId: ChallengeId): void;
  clock?: PendingChallengeClock;
  durationMs?: number;
}>;

/** Roster runtime for both reservation-free Waiting and reserved countdowns. */
export class ChallengeRuntime {
  readonly challengeId: ChallengeId;
  readonly position: Position;
  readonly defenderId: PlayerId;
  readonly waitingId: WaitingId | undefined;
  private readonly clock: PendingChallengeClock;
  private readonly durationMs: number;
  private readonly isPlayerConnected: (playerId: PlayerId) => boolean;
  private readonly onExpired: (challengeId: ChallengeId) => void;
  private readonly members: PlayerId[];
  private phaseValue: ChallengeRuntimePhase;
  private deadline: UnixTimestampMs | undefined;
  private timer: unknown | undefined;

  constructor(options: ChallengeRuntimeOptions) {
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
    this.challengeId = options.challengeId;
    this.position = { ...options.position };
    this.defenderId = options.defenderId;
    this.waitingId = options.waitingId;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.durationMs = durationMs;
    this.isPlayerConnected = options.isPlayerConnected;
    this.onExpired = options.onExpired;
    this.members = [options.defenderId, options.challengerId];
    this.phaseValue = options.waitingId === undefined ? "countdown" : "waiting";
    if (this.phaseValue === "countdown") this.startCountdown();
  }

  get phase(): ChallengeRuntimePhase { return this.phaseValue; }
  get participantIds(): readonly PlayerId[] { return [...this.members]; }
  get closesAt(): UnixTimestampMs | undefined { return this.deadline; }

  worldCell(): ChallengePendingWorldCell | ChallengeWaitingWorldCell {
    if (this.phaseValue === "waiting") {
      if (this.waitingId === undefined) throw new Error("Waiting challenge has no Waiting ID");
      return {
        kind: "challengeWaiting",
        challengeId: this.challengeId,
        waitingId: this.waitingId,
        defenderId: this.defenderId,
        participantIds: [...this.members],
      };
    }
    if (
      (this.phaseValue !== "countdown" && this.phaseValue !== "expired")
      || this.deadline === undefined
    ) {
      throw new Error(`Challenge ${this.challengeId} is not publicly open`);
    }
    return {
      kind: "challengePending",
      challengeId: this.challengeId,
      defenderId: this.defenderId,
      participantIds: [...this.members],
      closesAt: this.deadline,
    };
  }

  joinRejection(
    playerId: PlayerId,
  ): "challengeClosed" | "alreadyJoined" | "challengeFull" | null {
    if (this.closeIfDue() || !this.isOpen()) return "challengeClosed";
    if (this.members.includes(playerId)) return "alreadyJoined";
    if (this.members.length >= MAX_CHALLENGE_PARTICIPANTS) return "challengeFull";
    return null;
  }

  join(playerId: PlayerId): ChallengeRosterResult {
    const rejection = this.joinRejection(playerId);
    if (rejection !== null) return { accepted: false, reason: rejection };
    this.members.push(playerId);
    return { accepted: true };
  }

  leave(playerId: PlayerId): ChallengeRosterResult {
    if (this.closeIfDue() || !this.isOpen()) {
      return { accepted: false, reason: "challengeClosed" };
    }
    const index = this.members.indexOf(playerId);
    if (index < 0) return { accepted: false, reason: "notParticipant" };
    this.members.splice(index, 1);
    return {
      accepted: true,
      removedPlayerId: playerId,
      ...(this.members.length < 2
        ? { cancellation: this.cancel("insufficientParticipants") }
        : {}),
    };
  }

  disconnect(playerId: PlayerId): ChallengeRosterResult | null {
    if (!this.isOpen()) return null;
    if (playerId === this.defenderId) {
      const index = this.members.indexOf(playerId);
      if (index >= 0) this.members.splice(index, 1);
      this.phaseValue = "cancelled";
      this.clearTimer();
      return {
        accepted: true,
        ...(index >= 0 ? { removedPlayerId: playerId } : {}),
        cancellation: {
          reason: "defenderDisconnected",
          replacementCell: { kind: "unoccupied" },
        },
      };
    }
    if (this.closeIfDue() || !this.isOpen()) return null;
    const index = this.members.indexOf(playerId);
    if (index < 0) return null;
    this.members.splice(index, 1);
    return {
      accepted: true,
      removedPlayerId: playerId,
      ...(this.members.length < 2
        ? { cancellation: this.cancel("insufficientParticipants") }
        : {}),
    };
  }

  promoteToCountdown(): void {
    if (this.phaseValue !== "waiting") {
      throw new Error(`Challenge ${this.challengeId} is not Waiting`);
    }
    this.phaseValue = "countdown";
    this.startCountdown();
  }

  rollbackPromotion(): void {
    if (this.waitingId === undefined) {
      throw new Error(`Challenge ${this.challengeId} cannot roll back promotion`);
    }
    if (this.phaseValue === "waiting") return;
    if (this.phaseValue !== "countdown") {
      throw new Error(`Challenge ${this.challengeId} cannot roll back promotion`);
    }
    this.clearTimer();
    this.deadline = undefined;
    this.phaseValue = "waiting";
  }

  dispose(): void {
    if (this.phaseValue === "disposed") return;
    this.clearTimer();
    this.phaseValue = "disposed";
  }

  private isOpen(): boolean {
    return this.phaseValue === "waiting" || this.phaseValue === "countdown";
  }

  private cancel(reason: ChallengeCancellation["reason"]): ChallengeCancellation {
    this.clearTimer();
    this.phaseValue = "cancelled";
    return {
      reason,
      replacementCell: this.isPlayerConnected(this.defenderId)
        ? { kind: "occupied", playerId: this.defenderId }
        : { kind: "unoccupied" },
    };
  }

  private startCountdown(): void {
    const now = this.clock.now();
    assertTimestamp(now, "PendingChallengeClock.now()");
    if (now > Number.MAX_SAFE_INTEGER - this.durationMs) {
      throw new RangeError("Challenge deadline exceeds the safe integer range");
    }
    this.deadline = now + this.durationMs;
    this.scheduleTimer(this.durationMs);
  }

  private closeIfDue(): boolean {
    if (this.phaseValue !== "countdown" || this.deadline === undefined) return false;
    const now = this.clock.now();
    assertTimestamp(now, "PendingChallengeClock.now()");
    if (now < this.deadline) return false;
    this.clearTimer();
    this.phaseValue = "expired";
    this.onExpired(this.challengeId);
    return true;
  }

  private scheduleTimer(delayMs: number): void {
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      if (this.phaseValue !== "countdown") return;
      if (!this.closeIfDue() && this.deadline !== undefined) {
        this.scheduleTimer(this.deadline - this.clock.now());
      }
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function assertNonEmptyId(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty`);
}

function assertPosition(position: Position): void {
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y)
    || position.x < 0 || position.y < 0) {
    throw new RangeError("Challenge position must contain non-negative safe integers");
  }
}

function assertTimestamp(value: number, name: string): asserts value is UnixTimestampMs {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must return a non-negative safe integer`);
  }
}
