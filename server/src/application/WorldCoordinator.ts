import type {
  AdminBattle,
  AdminErrorCode,
  AdminWorldCellReplacement,
  BattleId,
  ChallengeId,
  PlayerId,
  Position,
  RequestId,
  WorldCell,
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
    return await this.enqueue(() => this.players.playerIds()
      .filter((playerId) => !this.players.get(playerId)?.isClosed)
      .sort());
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
        participant.attachBattle(battleId, battle);
      }
      battle.start();
      return { ok: true, battle: this.adminBattle(battleId, battle) };
    });
  }

  async adminReplaceWorldCells(
    changes: readonly AdminWorldCellReplacement[],
  ): Promise<AdminWorldReplacementResult> {
    return await this.enqueue(async () => {
      if (changes.length < 1 || changes.length > 256) {
        return adminFailure(
          "invalidRequest",
          "World replacement must contain 1 to 256 cells",
        );
      }

      const seenPositions = new Set<string>();
      const inspected: Array<Readonly<{
        change: AdminWorldCellReplacement;
        actual: WorldCell;
      }>> = [];
      for (const change of changes) {
        const key = `${change.position.x},${change.position.y}`;
        if (seenPositions.has(key)) {
          return adminFailure(
            "invalidRequest",
            `World replacement repeats position (${key})`,
          );
        }
        seenPositions.add(key);

        let actual: WorldCell;
        try {
          actual = this.world.cellAt(change.position);
        } catch {
          return adminFailure(
            "invalidRequest",
            `World position (${key}) is outside the grid`,
          );
        }
        if (!worldCellsEqual(actual, change.expected)) {
          return adminFailure(
            "conflict",
            `World position (${key}) no longer matches the expected cell`,
          );
        }
        if (change.next.kind === "occupied") {
          const owner = this.players.get(change.next.playerId);
          if (owner === undefined || owner.isClosed) {
            return adminFailure(
              "unknownPlayer",
              `World cell owner ${change.next.playerId} is not connected`,
            );
          }
        }
        inspected.push({ change, actual });
      }

      const pendingChallenges = new Map<ChallengeId, PendingRuntime>();
      const hostedBattles = new Map<BattleId, HostedBattle>();
      for (const { change, actual } of inspected) {
        switch (actual.kind) {
          case "unoccupied":
          case "occupied":
            break;
          case "challengePending": {
            const runtime = this.challenges.get(actual.challengeId);
            if (
              runtime === undefined
              || !positionsEqual(runtime.challenge.position, change.position)
              || !positionsEqual(
                this.world.positionForChallenge(actual.challengeId),
                change.position,
              )
              || !worldCellsEqual(runtime.challenge.worldCell(), actual)
            ) {
              return adminFailure(
                "lifecycleNotFound",
                `Challenge ${actual.challengeId} does not match the targeted world cell`,
              );
            }
            pendingChallenges.set(actual.challengeId, runtime);
            break;
          }
          case "battle": {
            const battle = this.battles.get(actual.battleId);
            const rosterPlayerIds = battle?.getRoster().map(({ playerId }) => playerId);
            if (
              battle === undefined
              || !positionsEqual(battle.worldPosition, change.position)
              || !positionsEqual(
                this.world.positionForBattle(actual.battleId),
                change.position,
              )
              || !stringArraysEqual(rosterPlayerIds, actual.playerIds)
            ) {
              return adminFailure(
                "lifecycleNotFound",
                `Battle ${actual.battleId} does not match the targeted world cell`,
              );
            }
            hostedBattles.set(actual.battleId, battle);
            break;
          }
        }
      }

      for (const [challengeId, runtime] of pendingChallenges) {
        this.challenges.delete(challengeId);
        this.closedChallenges.add(challengeId);
        runtime.unsubscribe();
        runtime.challenge.dispose();
      }
      for (const [battleId, battle] of hostedBattles) {
        this.terminalUnsubscribers.get(battleId)?.();
        this.terminalUnsubscribers.delete(battleId);
        if (this.battles.get(battleId) !== battle) {
          throw new Error(`Preflighted battle ${battleId} changed during cancellation`);
        }
        const removed = await this.battles.remove(battleId);
        if (!removed) {
          throw new Error(`Preflighted battle ${battleId} could not be cancelled`);
        }
      }

      const delta = this.world.replaceCells(inspected.map(({ change }) => ({
        position: change.position,
        expected: change.expected,
        cell: change.next,
      })));
      if (delta === null) {
        throw new Error("Validated world replacement unexpectedly produced no delta");
      }

      for (const [battleId, battle] of hostedBattles) {
        for (const { playerId } of battle.getRoster()) {
          this.players.get(playerId)?.detachBattle(battleId, true);
        }
      }
      return { ok: true, delta };
    });
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

function adminFailure(
  code: AdminErrorCode,
  message: string,
): AdminOperationFailure {
  return { ok: false, code, message };
}

function positionsEqual(
  left: Position | undefined | null,
  right: Position | undefined | null,
): boolean {
  if (left == null || right == null) return left === right;
  return left.x === right.x && left.y === right.y;
}

function stringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  return left !== undefined
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function worldCellsEqual(left: WorldCell, right: WorldCell): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "unoccupied":
      return true;
    case "occupied":
      return right.kind === "occupied" && left.playerId === right.playerId;
    case "challengePending":
      return right.kind === "challengePending"
        && left.challengeId === right.challengeId
        && left.defenderId === right.defenderId
        && left.closesAt === right.closesAt
        && stringArraysEqual(left.participantIds, right.participantIds);
    case "battle":
      return right.kind === "battle"
        && left.battleId === right.battleId
        && stringArraysEqual(left.playerIds, right.playerIds);
  }
}
