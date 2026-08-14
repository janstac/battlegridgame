import type {
  AdminBattle,
  AdminErrorCode,
  AdminWorldCellReplacement,
  BattleId,
  ChallengeId,
  PlayerId,
  Position,
  RequestId,
  WorldCommandRejectionReason,
  WorldDelta,
  WorldSnapshot,
} from "@grid-game/shared";
import type { BattleRegistry } from "../game/BattleRegistry.ts";
import {
  STANDARD_BATTLE_MAX_PARTICIPANTS,
  type StandardBattleFactory,
} from "../game/StandardBattleFactory.ts";
import type {
  HostedBattle,
  HostedBattleTerminalResult,
} from "../game/HostedBattle.ts";
import {
  DEFAULT_CHALLENGE_DURATION_MS,
  PendingChallenge,
  type PendingChallengeClock,
  type PendingChallengeEvent,
} from "../world/PendingChallenge.ts";
import type { World } from "../world/World.ts";
import type { ClientConnection } from "./ClientConnection.ts";
import type { PlayerDirectory } from "./PlayerDirectory.ts";

export type WorldCoordinatorOptions = Readonly<{
  debugEnabled?: boolean;
  maxDebugPlayers?: number;
  challengeClock?: PendingChallengeClock;
  challengeDurationMs?: number;
}>;

type PendingRuntime = Readonly<{
  challenge: PendingChallenge;
  unsubscribe(): void;
}>;

export type AdminOperationFailure = Readonly<{
  ok: false;
  code: AdminErrorCode;
  message: string;
}>;

export type AdminBattleStartResult =
  | Readonly<{ ok: true; battle: AdminBattle }>
  | AdminOperationFailure;

export type AdminWorldReplacementResult =
  | Readonly<{ ok: true; delta: WorldDelta }>
  | AdminOperationFailure;

/**
 * Serializes every operation spanning connections, World cells, challenges,
 * and hosted battles. Individual HostedBattle instances retain their own
 * command/tick queue; terminal callbacks only enqueue work here.
 */
export class WorldCoordinator {
  readonly debugEnabled: boolean;
  private readonly players: PlayerDirectory;
  private readonly battles: BattleRegistry;
  private readonly world: World;
  private readonly factory: StandardBattleFactory;
  private readonly maxDebugPlayers: number;
  private readonly challengeClock: PendingChallengeClock | undefined;
  private readonly challengeDurationMs: number;
  private readonly challenges = new Map<ChallengeId, PendingRuntime>();
  private readonly closedChallenges = new Set<ChallengeId>();
  private readonly terminalUnsubscribers = new Map<BattleId, () => void>();
  private operations: Promise<void> = Promise.resolve();
  private nextChallengeSequence = 1;
  private disposed = false;

  constructor(
    players: PlayerDirectory,
    battles: BattleRegistry,
    world: World,
    factory: StandardBattleFactory,
    options: WorldCoordinatorOptions = {},
  ) {
    this.players = players;
    this.battles = battles;
    this.world = world;
    this.factory = factory;
    this.debugEnabled = options.debugEnabled ?? false;
    this.maxDebugPlayers = Math.min(
      options.maxDebugPlayers ?? STANDARD_BATTLE_MAX_PARTICIPANTS,
      STANDARD_BATTLE_MAX_PARTICIPANTS,
    );
    this.challengeClock = options.challengeClock;
    this.challengeDurationMs = options.challengeDurationMs
      ?? DEFAULT_CHALLENGE_DURATION_MS;
  }

  connectedPlayerIds(): readonly PlayerId[] { return this.players.playerIds(); }

  async adminListPlayers(): Promise<readonly PlayerId[]> {
    return await this.enqueue(() => [...this.players.playerIds()].sort());
  }

  async adminGetWorld(): Promise<WorldSnapshot> {
    return await this.enqueue(() => this.world.snapshot());
  }

  async adminListBattles(): Promise<readonly AdminBattle[]> {
    return await this.enqueue(() => [...this.battles.entries()]
      .sort(({ battleId: left }, { battleId: right }) => left.localeCompare(right))
      .map(({ battleId, battle }) => this.adminBattle(battleId, battle)));
  }

  async adminStartBattle(
    playerIds: readonly PlayerId[],
  ): Promise<AdminBattleStartResult> {
    return await this.enqueue(() => {
      if (
        playerIds.length < 2
        || playerIds.length > this.maxDebugPlayers
        || new Set(playerIds).size !== playerIds.length
      ) {
        return {
          ok: false,
          code: "invalidRoster",
          message: `Battle roster must contain 2 to ${this.maxDebugPlayers} unique players`,
        };
      }
      const participants = playerIds.map((id) => this.players.get(id));
      if (participants.some(
        (participant) => participant === undefined || participant.isClosed,
      )) {
        return {
          ok: false,
          code: "unknownPlayer",
          message: "Every battle participant must be connected",
        };
      }

      const battle = this.factory.create(playerIds);
      const battleId = this.registerBattle(battle);
      for (const participant of participants as ClientConnection[]) {
        participant.attachBattle(battleId, battle, null);
      }
      battle.start();
      return { ok: true, battle: this.adminBattle(battleId, battle) };
    });
  }

  async adminReplaceWorldCells(
    _changes: readonly AdminWorldCellReplacement[],
  ): Promise<AdminWorldReplacementResult> {
    return {
      ok: false,
      code: "internal",
      message: "World replacement is not available",
    };
  }

  /** Allocates initial cells, sends a converged snapshot, then subscribes. */
  async connect(connection: ClientConnection): Promise<void> {
    await this.enqueue(() => {
      if (connection.isClosed) return;
      this.world.allocateUnoccupiedCells(connection.playerId);
      connection.sendWorldSnapshot(this.world.snapshot());
      connection.setWorldSubscription(this.world.subscribe((delta) => {
        connection.sendWorldDelta(delta);
      }));
    });
  }

  async requestWorldSnapshot(connection: ClientConnection): Promise<void> {
    await this.enqueue(() => connection.sendWorldSnapshot(this.world.snapshot()));
  }

  async challengeWorldCell(
    requester: ClientConnection,
    position: Position,
  ): Promise<WorldCommandRejectionReason | null> {
    return await this.enqueue(() => {
      let cell;
      try { cell = this.world.cellAt(position); } catch { return "invalidTarget"; }
      if (cell.kind !== "occupied") return "invalidTarget";
      if (cell.playerId === requester.playerId) return "selfChallenge";
      const defender = this.players.get(cell.playerId);
      if (defender === undefined || defender.isClosed) return "invalidTarget";

      const challengeId = `challenge-${this.nextChallengeSequence++}`;
      let challenge: PendingChallenge;
      challenge = new PendingChallenge({
        challengeId,
        position,
        defenderId: cell.playerId,
        challengerId: requester.playerId,
        isPlayerConnected: (playerId) => {
          const connection = this.players.get(playerId);
          return connection !== undefined && !connection.isClosed;
        },
        ...(this.challengeClock === undefined ? {} : { clock: this.challengeClock }),
        durationMs: this.challengeDurationMs,
      });
      const unsubscribe = challenge.subscribe((event) => {
        void this.enqueue(() => this.handleChallengeEvent(event)).catch(() => undefined);
      });
      this.challenges.set(challengeId, { challenge, unsubscribe });
      try {
        this.world.replaceCell(
          position,
          { kind: "occupied", playerId: cell.playerId },
          challenge.worldCell(),
        );
      } catch (error) {
        this.challenges.delete(challengeId);
        unsubscribe();
        challenge.dispose();
        throw error;
      }
      return null;
    });
  }

  async joinWorldChallenge(
    requester: ClientConnection,
    challengeId: ChallengeId,
  ): Promise<WorldCommandRejectionReason | null> {
    return await this.enqueue(() => {
      const runtime = this.challenges.get(challengeId);
      if (runtime === undefined) {
        return this.closedChallenges.has(challengeId)
          ? "challengeClosed"
          : "unknownChallenge";
      }
      const result = runtime.challenge.join(requester.playerId);
      return result.accepted ? null : result.reason;
    });
  }

  async leaveWorldChallenge(
    requester: ClientConnection,
    challengeId: ChallengeId,
  ): Promise<WorldCommandRejectionReason | null> {
    return await this.enqueue(() => {
      const runtime = this.challenges.get(challengeId);
      if (runtime === undefined) {
        return this.closedChallenges.has(challengeId)
          ? "challengeClosed"
          : "unknownChallenge";
      }
      const result = runtime.challenge.leave(requester.playerId);
      return result.accepted ? null : result.reason;
    });
  }

  async createDebugBattle(
    requester: ClientConnection,
    playerIds: readonly PlayerId[],
  ): Promise<
    | "debugDisabled"
    | "invalidPlayerCount"
    | "duplicatePlayerIds"
    | "unknownPlayer"
    | "requesterNotIncluded"
    | null
  > {
    return await this.enqueue(() => {
      if (!this.debugEnabled) return "debugDisabled";
      if (playerIds.length < 2 || playerIds.length > this.maxDebugPlayers) {
        return "invalidPlayerCount";
      }
      if (new Set(playerIds).size !== playerIds.length) return "duplicatePlayerIds";
      if (!playerIds.includes(requester.playerId)) return "requesterNotIncluded";
      const participants = playerIds.map((id) => this.players.get(id));
      if (participants.some(
        (participant) => participant === undefined || participant.isClosed,
      )) return "unknownPlayer";

      const battle = this.factory.create(playerIds);
      const battleId = this.registerBattle(battle);
      for (const participant of participants as ClientConnection[]) {
        participant.attachBattle(battleId, battle);
      }
      battle.start();
      return null;
    });
  }

  async leaveBattle(
    connection: ClientConnection,
    battleId: BattleId,
    requestId?: RequestId,
  ): Promise<void> {
    await this.enqueue(async () => {
      const membership = connection.getBattleMembership(battleId);
      if (membership === undefined) return;
      await membership.battle.withdraw(membership.participantId);
      connection.detachBattle(battleId, true, requestId);
    });
  }

  /** Marks the connection closed before this call, so no further output leaks. */
  async disconnect(connection: ClientConnection): Promise<void> {
    await this.enqueue(async () => {
      for (const runtime of [...this.challenges.values()]) {
        runtime.challenge.disconnect(connection.playerId);
      }
      const memberships = this.battles.membershipsForPlayer(connection.playerId);
      for (const { battleId, battle } of memberships) {
        const participantId = battle.participantIdForPlayer(connection.playerId);
        if (participantId !== undefined) await battle.withdraw(participantId);
        connection.detachBattle(battleId, false);
      }
      this.world.clearOccupiedCells(connection.playerId);
      this.players.remove(connection.playerId, connection);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    for (;;) {
      const pending = this.operations;
      await pending;
      if (pending === this.operations) break;
    }
    this.disposed = true;
    for (const runtime of this.challenges.values()) {
      runtime.unsubscribe();
      runtime.challenge.dispose();
    }
    this.challenges.clear();
    for (const unsubscribe of this.terminalUnsubscribers.values()) unsubscribe();
    this.terminalUnsubscribers.clear();
  }

  private handleChallengeEvent(event: PendingChallengeEvent): void {
    const runtime = this.challenges.get(event.challenge.challengeId);
    if (runtime === undefined) return;
    switch (event.kind) {
      case "rosterChanged":
        this.world.replaceCell(
          event.challenge.position,
          { kind: "challengePending", challengeId: event.challenge.challengeId },
          runtime.challenge.worldCell(),
        );
        return;
      case "cancelled":
        this.world.replaceCell(
          event.challenge.position,
          { kind: "challengePending", challengeId: event.challenge.challengeId },
          event.replacementCell,
        );
        this.finishChallenge(event.challenge.challengeId);
        return;
      case "expired":
        this.startExpiredChallenge(runtime);
        return;
    }
  }

  private startExpiredChallenge(runtime: PendingRuntime): void {
    const challenge = runtime.challenge;
    const defender = this.players.get(challenge.defenderId);
    if (defender === undefined || defender.isClosed) {
      this.world.replaceCell(
        challenge.position,
        { kind: "challengePending", challengeId: challenge.challengeId },
        { kind: "unoccupied" },
      );
      this.finishChallenge(challenge.challengeId);
      return;
    }
    const playerIds = challenge.participantIds.filter((playerId) => {
      const connection = this.players.get(playerId);
      return connection !== undefined && !connection.isClosed;
    });
    if (playerIds.length < 2) {
      this.world.replaceCell(
        challenge.position,
        { kind: "challengePending", challengeId: challenge.challengeId },
        { kind: "occupied", playerId: challenge.defenderId },
      );
      this.finishChallenge(challenge.challengeId);
      return;
    }

    const battle = this.factory.create(playerIds, challenge.position);
    const battleId = this.registerBattle(battle);
    this.world.replaceCell(
      challenge.position,
      { kind: "challengePending", challengeId: challenge.challengeId },
      { kind: "battle", battleId, playerIds },
    );
    this.finishChallenge(challenge.challengeId);
    for (const playerId of playerIds) {
      this.players.get(playerId)?.attachBattle(battleId, battle);
    }
    battle.start();
  }

  private finishChallenge(challengeId: ChallengeId): void {
    const runtime = this.challenges.get(challengeId);
    if (runtime === undefined) return;
    this.challenges.delete(challengeId);
    this.closedChallenges.add(challengeId);
    runtime.unsubscribe();
    runtime.challenge.dispose();
  }

  private registerBattle(battle: HostedBattle): BattleId {
    const battleId = this.battles.register(battle);
    const unsubscribe = battle.onTerminal((result) => {
      void this.enqueue(
        async () => this.resolveBattle(battleId, battle, result),
      ).catch(() => undefined);
    });
    this.terminalUnsubscribers.set(battleId, unsubscribe);
    return battleId;
  }

  private adminBattle(battleId: BattleId, battle: HostedBattle): AdminBattle {
    return {
      battleId,
      worldPosition: battle.worldPosition,
      roster: [...battle.getRoster()],
      snapshot: battle.snapshot,
    };
  }

  private async resolveBattle(
    battleId: BattleId,
    battle: HostedBattle,
    result: HostedBattleTerminalResult,
  ): Promise<void> {
    if (this.battles.get(battleId) !== battle) return;
    if (result.worldPosition !== null) {
      const winner = result.winnerPlayerId === null
        ? undefined
        : this.players.get(result.winnerPlayerId);
      this.world.replaceCell(
        result.worldPosition,
        { kind: "battle", battleId },
        result.winnerPlayerId === null || winner === undefined || winner.isClosed
          ? { kind: "unoccupied" }
          : { kind: "occupied", playerId: result.winnerPlayerId },
      );
    }
    for (const participant of battle.getRoster()) {
      this.players.get(participant.playerId)?.detachBattle(battleId, true);
    }
    this.terminalUnsubscribers.get(battleId)?.();
    this.terminalUnsubscribers.delete(battleId);
    await this.battles.remove(battleId);
  }

  private async enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("WorldCoordinator has been disposed");
    const next = this.operations.then(operation);
    this.operations = next.then(() => undefined, () => undefined);
    return await next;
  }
}
