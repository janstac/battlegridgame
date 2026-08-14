import type {
  BattleId,
  BattleParticipantId,
  NetworkClientMessage,
  NetworkServerMessage,
  PlayerId,
  RequestId,
  WorldCommandRejectionReason,
  WorldDelta,
  WorldSnapshot,
} from "@grid-game/shared";
import type { HostedBattle } from "../game/HostedBattle.ts";
import type { WorldCoordinator } from "./WorldCoordinator.ts";

export type BattleMembership = Readonly<{
  battle: HostedBattle;
  participantId: BattleParticipantId;
  detach(): void;
}>;

/** Application-level state for one authenticated multiplexed client socket. */
export class ClientConnection {
  readonly playerId: PlayerId;
  private readonly coordinator: WorldCoordinator;
  private readonly output: (message: NetworkServerMessage) => void;
  private readonly protocolViolation: () => void;
  private readonly memberships = new Map<BattleId, BattleMembership>();
  private operations: Promise<void> = Promise.resolve();
  private unsubscribeWorld: (() => void) | undefined;
  private closing: Promise<void> | undefined;
  private opened = false;
  private closed = false;

  constructor(
    playerId: PlayerId,
    coordinator: WorldCoordinator,
    output: (message: NetworkServerMessage) => void,
    protocolViolation: () => void,
  ) {
    this.playerId = playerId;
    this.coordinator = coordinator;
    this.output = output;
    this.protocolViolation = protocolViolation;
  }

  get isClosed(): boolean { return this.closed; }

  /** Sends identity first, then allocates/bootstraps World state before input. */
  async open(): Promise<void> {
    if (this.closed || this.opened) return;
    this.opened = true;
    this.output({ type: "connected", playerId: this.playerId });
    const initialized = this.operations.then(() => this.coordinator.connect(this));
    this.operations = initialized.catch(() => undefined);
    await initialized;
  }

  async receive(message: NetworkClientMessage): Promise<void> {
    const next = this.operations.then(async () => {
      if (!this.closed) await this.handle(message);
    });
    this.operations = next.catch(() => undefined);
    await next;
  }

  private async handle(message: NetworkClientMessage): Promise<void> {
    switch (message.type) {
      case "challengeWorldCell":
        await this.sendWorldCommandResult(
          message.requestId,
          this.coordinator.challengeWorldCell(this, message.position),
        );
        return;
      case "joinWorldChallenge":
        await this.sendWorldCommandResult(
          message.requestId,
          this.coordinator.joinWorldChallenge(this, message.challengeId),
        );
        return;
      case "leaveWorldChallenge":
        await this.sendWorldCommandResult(
          message.requestId,
          this.coordinator.leaveWorldChallenge(this, message.challengeId),
        );
        return;
      case "requestWorldSnapshot":
        await this.coordinator.requestWorldSnapshot(this);
        return;
      case "leaveBattle":
        await this.coordinator.leaveBattle(this, message.battleId, message.requestId);
        return;
      case "battleMessage": {
        const membership = this.memberships.get(message.battleId);
        if (membership === undefined) { this.failProtocol(); return; }
        await membership.battle.receive(
          membership.participantId,
          message.message,
          (reply) => {
            if (!this.closed && this.memberships.has(message.battleId)) {
              this.output({ type: "battleMessage", battleId: message.battleId, message: reply });
            }
          },
        );
        return;
      }
    }
  }

  attachBattle(
    battleId: BattleId,
    battle: HostedBattle,
  ): void {
    if (this.closed || this.memberships.has(battleId)) return;
    const participantId = battle.participantIdForPlayer(this.playerId);
    if (participantId === undefined) {
      throw new Error(`Player ${this.playerId} is not in battle ${battleId}`);
    }
    const attachment = battle.attach((message) => {
      if (!this.closed && this.memberships.has(battleId)) {
        this.output({ type: "battleMessage", battleId, message });
      }
    });
    this.memberships.set(battleId, {
      battle,
      participantId,
      detach: attachment.detach,
    });
    this.output({
      type: "battleJoined",
      battleId,
      worldPosition: battle.worldPosition,
      localParticipantId: participantId,
      roster: [...battle.getRoster()],
      snapshot: attachment.snapshot,
    });
  }

  getBattleMembership(battleId: BattleId): BattleMembership | undefined {
    return this.memberships.get(battleId);
  }

  detachBattle(
    battleId: BattleId,
    acknowledge: boolean,
    requestId?: RequestId,
  ): void {
    const membership = this.memberships.get(battleId);
    if (membership === undefined) return;
    this.memberships.delete(battleId);
    membership.detach();
    if (!acknowledge || this.closed) return;
    this.output({
      type: "battleLeft",
      battleId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  sendWorldSnapshot(snapshot: WorldSnapshot): void {
    if (!this.closed) this.output({ type: "worldSnapshot", snapshot });
  }

  sendWorldDelta(delta: WorldDelta): void {
    if (!this.closed) this.output({ type: "worldDelta", ...delta });
  }

  setWorldSubscription(unsubscribe: () => void): void {
    this.unsubscribeWorld?.();
    if (this.closed) unsubscribe();
    else this.unsubscribeWorld = unsubscribe;
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return await this.closing;
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeWorld?.();
    this.unsubscribeWorld = undefined;
    const disconnecting = this.operations.then(() => this.coordinator.disconnect(this));
    this.operations = disconnecting.catch(() => undefined);
    this.closing = disconnecting.finally(() => {
      for (const membership of this.memberships.values()) membership.detach();
      this.memberships.clear();
    });
    await this.closing;
  }

  private async sendWorldCommandResult(
    requestId: RequestId,
    result: Promise<WorldCommandRejectionReason | null>,
  ): Promise<void> {
    const reason = await result;
    if (this.closed) return;
    this.output(reason === null
      ? { type: "worldCommandAccepted", requestId }
      : { type: "worldCommandRejected", requestId, reason });
  }

  private failProtocol(): void {
    void this.close();
    this.protocolViolation();
  }
}
