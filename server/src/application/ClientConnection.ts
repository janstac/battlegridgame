import type {
  BattleId,
  BattleParticipantId,
  NetworkClientMessage,
  NetworkServerMessage,
  PlayerId,
  RequestId,
  ResumeToken,
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

export type ClientTransport = Readonly<{
  output(message: NetworkServerMessage): void;
  protocolViolation(): void;
}>;

/** Application-level state for one logical player session across replaceable transports. */
export class ClientConnection {
  readonly playerId: PlayerId;
  readonly resumeToken: ResumeToken;
  private readonly coordinator: WorldCoordinator;
  private readonly memberships = new Map<BattleId, BattleMembership>();
  private transport: ClientTransport | null = null;
  private operations: Promise<void> = Promise.resolve();
  private unsubscribeWorld: (() => void) | undefined;
  private closing: Promise<void> | undefined;
  private opened = false;
  private closed = false;
  private lastChallengeable: boolean | undefined;

  constructor(playerId: PlayerId, resumeToken: ResumeToken, coordinator: WorldCoordinator);
  constructor(
    playerId: PlayerId,
    coordinator: WorldCoordinator,
    output: (message: NetworkServerMessage) => void,
    protocolViolation: () => void,
  );
  constructor(
    playerId: PlayerId,
    resumeTokenOrCoordinator: ResumeToken | WorldCoordinator,
    coordinatorOrOutput: WorldCoordinator | ((message: NetworkServerMessage) => void),
    protocolViolation?: () => void,
  ) {
    this.playerId = playerId;
    if (typeof resumeTokenOrCoordinator === "string") {
      this.resumeToken = resumeTokenOrCoordinator;
      this.coordinator = coordinatorOrOutput as WorldCoordinator;
    } else {
      this.resumeToken = `legacy-session-${playerId}`.padEnd(32, "-");
      this.coordinator = resumeTokenOrCoordinator;
      this.transport = {
        output: coordinatorOrOutput as (message: NetworkServerMessage) => void,
        protocolViolation: protocolViolation ?? (() => undefined),
      };
    }
  }

  get isClosed(): boolean { return this.closed; }
  get isAttached(): boolean { return this.transport !== null; }

  attachTransport(transport: ClientTransport): ClientTransport | null {
    if (this.closed) return transport;
    const previous = this.transport;
    this.transport = transport;
    return previous;
  }

  detachTransport(expected: ClientTransport): boolean {
    if (this.transport !== expected) return false;
    this.transport = null;
    return true;
  }

  async open(): Promise<void> {
    if (this.closed || this.opened) return;
    this.opened = true;
    this.send({ type: "connected", playerId: this.playerId, resumeToken: this.resumeToken });
    const initialized = this.operations.then(() => this.coordinator.connect(this));
    this.operations = initialized.catch(() => undefined);
    await initialized;
  }

  async resume(): Promise<void> {
    if (this.closed || !this.opened) return;
    this.send({ type: "connected", playerId: this.playerId, resumeToken: this.resumeToken });
    const resyncing = this.operations.then(async () => {
      if (this.closed) return;
      await this.coordinator.requestWorldSnapshot(this);
      for (const [battleId, membership] of this.memberships) this.sendBattleJoined(battleId, membership);
    });
    this.operations = resyncing.catch(() => undefined);
    await resyncing;
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
        await this.sendWorldCommandResult(message.requestId, this.coordinator.challengeWorldCell(this, message.position)); return;
      case "joinWorldChallenge":
        await this.sendWorldCommandResult(message.requestId, this.coordinator.joinWorldChallenge(this, message.challengeId)); return;
      case "leaveWorldChallenge":
        await this.sendWorldCommandResult(message.requestId, this.coordinator.leaveWorldChallenge(this, message.challengeId)); return;
      case "requestWorldSnapshot":
        await this.coordinator.requestWorldSnapshot(this); return;
      case "leaveBattle":
        await this.coordinator.leaveBattle(this, message.battleId, message.requestId); return;
      case "battleMessage": {
        const membership = this.memberships.get(message.battleId);
        if (membership === undefined) { this.failProtocol(); return; }
        await membership.battle.receive(membership.participantId, message.message, (reply) => {
          if (!this.closed && this.memberships.has(message.battleId)) {
            this.send({ type: "battleMessage", battleId: message.battleId, message: reply });
          }
        });
        return;
      }
    }
  }

  attachBattle(battleId: BattleId, battle: HostedBattle): void {
    if (this.closed || this.memberships.has(battleId)) return;
    const participantId = battle.participantIdForPlayer(this.playerId);
    if (participantId === undefined) throw new Error(`Player ${this.playerId} is not in battle ${battleId}`);
    const attachment = battle.attach((message) => {
      if (!this.closed && this.memberships.has(battleId)) this.send({ type: "battleMessage", battleId, message });
    });
    const membership = { battle, participantId, detach: attachment.detach };
    this.memberships.set(battleId, membership);
    this.sendBattleJoined(battleId, membership, attachment.snapshot);
  }

  getBattleMembership(battleId: BattleId): BattleMembership | undefined { return this.memberships.get(battleId); }

  detachBattle(battleId: BattleId, acknowledge: boolean, requestId?: RequestId): void {
    const membership = this.memberships.get(battleId);
    if (membership === undefined) return;
    this.memberships.delete(battleId);
    membership.detach();
    if (!acknowledge || this.closed) return;
    this.send({ type: "battleLeft", battleId, ...(requestId === undefined ? {} : { requestId }) });
  }

  sendWorldSnapshot(snapshot: WorldSnapshot, challengeable: boolean): void {
    if (this.closed) return;
    this.lastChallengeable = challengeable;
    this.send({ type: "worldSnapshot", challengeable, snapshot });
  }

  sendWorldDelta(delta: WorldDelta, challengeable: boolean): void {
    if (this.closed) return;
    this.lastChallengeable = challengeable;
    this.send({ type: "worldDelta", challengeable, ...delta });
  }

  refreshChallengeability(snapshot: WorldSnapshot, challengeable: boolean): void {
    if (this.closed || this.lastChallengeable === challengeable) return;
    this.sendWorldSnapshot(snapshot, challengeable);
  }

  setWorldSubscription(unsubscribe: () => void): void {
    this.unsubscribeWorld?.();
    if (this.closed) unsubscribe(); else this.unsubscribeWorld = unsubscribe;
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return await this.closing;
    if (this.closed) return;
    this.closed = true;
    this.transport = null;
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

  private sendBattleJoined(battleId: BattleId, membership: BattleMembership, snapshot = membership.battle.snapshot): void {
    this.send({
      type: "battleJoined",
      battleId,
      worldPosition: membership.battle.worldPosition,
      localParticipantId: membership.participantId,
      roster: [...membership.battle.getRoster()],
      snapshot,
    });
  }

  private send(message: NetworkServerMessage): void { this.transport?.output(message); }

  private async sendWorldCommandResult(requestId: RequestId, result: Promise<WorldCommandRejectionReason | null>): Promise<void> {
    const reason = await result;
    if (this.closed) return;
    this.send(reason === null
      ? { type: "worldCommandAccepted", requestId }
      : { type: "worldCommandRejected", requestId, reason });
  }

  private failProtocol(): void {
    const transport = this.transport;
    void this.close();
    transport?.protocolViolation();
  }
}
