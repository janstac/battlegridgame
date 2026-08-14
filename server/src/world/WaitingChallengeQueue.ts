import type { ChallengeId, WaitingId } from "@grid-game/shared";

/** Process-local monotonic Waiting identifiers with stable ordered iteration. */
export class WaitingChallengeQueue {
  private readonly waiting = new Map<ChallengeId, WaitingId>();
  private nextSequence: WaitingId | null = 1;

  enqueue(challengeId: ChallengeId): WaitingId {
    const existing = this.waiting.get(challengeId);
    if (existing !== undefined) return existing;
    if (this.nextSequence === null) {
      throw new RangeError("Waiting challenge identifier space is exhausted");
    }
    const waitingId = this.nextSequence;
    this.nextSequence = waitingId === Number.MAX_SAFE_INTEGER
      ? null
      : waitingId + 1;
    this.waiting.set(challengeId, waitingId);
    return waitingId;
  }

  remove(challengeId: ChallengeId): boolean {
    return this.waiting.delete(challengeId);
  }

  waitingIdFor(challengeId: ChallengeId): WaitingId | undefined {
    return this.waiting.get(challengeId);
  }

  entriesInOrder(): ReadonlyArray<Readonly<{
    challengeId: ChallengeId;
    waitingId: WaitingId;
  }>> {
    return [...this.waiting]
      .map(([challengeId, waitingId]) => ({ challengeId, waitingId }))
      .sort((left, right) => left.waitingId - right.waitingId);
  }

  get size(): number { return this.waiting.size; }

  clear(): void { this.waiting.clear(); }
}
