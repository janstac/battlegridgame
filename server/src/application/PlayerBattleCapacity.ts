import type { ChallengeId, PlayerId } from "@grid-game/shared";
import type { BattleRegistry } from "../game/BattleRegistry.ts";

export const DEFAULT_MAX_CONCURRENT_BATTLES_PER_PLAYER = 4;

/** Validates and returns the configured per-player concurrent battle limit. */
export function validateMaxConcurrentBattlesPerPlayer(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "maxConcurrentBattlesPerPlayer must be a positive safe integer",
    );
  }
  return value;
}

/**
 * Owns countdown reservations and combines them with live registry membership.
 * Waiting roster membership deliberately does not appear in this index.
 */
export class PlayerBattleCapacity {
  readonly maximum: number;
  private readonly battles: BattleRegistry;
  private readonly reservations = new Map<ChallengeId, Set<PlayerId>>();
  private readonly reservationCounts = new Map<PlayerId, number>();

  constructor(
    battles: BattleRegistry,
    maximum = DEFAULT_MAX_CONCURRENT_BATTLES_PER_PLAYER,
  ) {
    this.battles = battles;
    this.maximum = validateMaxConcurrentBattlesPerPlayer(maximum);
  }

  activeMemberships(playerId: PlayerId): number {
    return this.battles.membershipsForPlayer(playerId).filter(({ battle }) =>
      battle.getRoster().some((participant) =>
        participant.playerId === playerId && participant.status === "active",
      ),
    ).length;
  }

  countdownReservations(playerId: PlayerId): number {
    return this.reservationCounts.get(playerId) ?? 0;
  }

  committed(playerId: PlayerId): number {
    return this.activeMemberships(playerId) + this.countdownReservations(playerId);
  }

  hasCapacity(playerId: PlayerId): boolean {
    return this.committed(playerId) < this.maximum;
  }

  canReserveRoster(playerIds: readonly PlayerId[]): boolean {
    return new Set(playerIds).size === playerIds.length
      && playerIds.every((playerId) => this.hasCapacity(playerId));
  }

  reserveRoster(challengeId: ChallengeId, playerIds: readonly PlayerId[]): boolean {
    if (this.reservations.has(challengeId)) {
      throw new Error(`Challenge ${challengeId} already owns capacity reservations`);
    }
    if (!this.canReserveRoster(playerIds)) return false;
    const roster = new Set(playerIds);
    this.reservations.set(challengeId, roster);
    for (const playerId of roster) this.increment(playerId);
    return true;
  }

  reservePlayer(challengeId: ChallengeId, playerId: PlayerId): boolean {
    const roster = this.reservations.get(challengeId);
    if (roster === undefined) {
      throw new Error(`Challenge ${challengeId} has no capacity reservations`);
    }
    if (roster.has(playerId)) return true;
    if (!this.hasCapacity(playerId)) return false;
    roster.add(playerId);
    this.increment(playerId);
    return true;
  }

  releasePlayer(challengeId: ChallengeId, playerId: PlayerId): boolean {
    const roster = this.reservations.get(challengeId);
    if (roster === undefined || !roster.delete(playerId)) return false;
    this.decrement(playerId);
    return true;
  }

  releaseChallenge(challengeId: ChallengeId): readonly PlayerId[] {
    const roster = this.reservations.get(challengeId);
    if (roster === undefined) return [];
    this.reservations.delete(challengeId);
    for (const playerId of roster) this.decrement(playerId);
    return [...roster];
  }

  reservedRoster(challengeId: ChallengeId): readonly PlayerId[] {
    return [...(this.reservations.get(challengeId) ?? [])];
  }

  get reservationSize(): number { return this.reservations.size; }

  clear(): void {
    this.reservations.clear();
    this.reservationCounts.clear();
  }

  private increment(playerId: PlayerId): void {
    const next = (this.reservationCounts.get(playerId) ?? 0) + 1;
    if (this.activeMemberships(playerId) + next > this.maximum) {
      throw new Error(`Battle capacity exceeded for ${playerId}`);
    }
    this.reservationCounts.set(playerId, next);
  }

  private decrement(playerId: PlayerId): void {
    const current = this.reservationCounts.get(playerId);
    if (current === undefined || current < 1) {
      throw new Error(`Missing battle capacity reservation for ${playerId}`);
    }
    if (current === 1) this.reservationCounts.delete(playerId);
    else this.reservationCounts.set(playerId, current - 1);
  }
}
