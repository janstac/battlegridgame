import type {
  BattleId,
  NetworkClientMessage,
  NetworkServerMessage,
  PlayerId,
} from "@grid-game/shared";
import type { BattleCoordinator } from "./BattleCoordinator.ts";
import type { HostedBattle } from "../game/HostedBattle.ts";

type Membership = { battle: HostedBattle; detach(): void };

/** Application-level state for one authenticated multiplexed client socket. */
export class ClientConnection {
  readonly playerId: PlayerId;
  private readonly coordinator: BattleCoordinator;
  private readonly output: (message: NetworkServerMessage) => void;
  private readonly protocolViolation: () => void;
  private readonly memberships = new Map<BattleId, Membership>();
  private operations: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    playerId: PlayerId,
    coordinator: BattleCoordinator,
    output: (message: NetworkServerMessage) => void,
    protocolViolation: () => void,
  ) {
    this.playerId = playerId;
    this.coordinator = coordinator;
    this.output = output;
    this.protocolViolation = protocolViolation;
  }

  sendConnected(): void { this.output({ type: "connected", playerId: this.playerId }); }

  async receive(message: NetworkClientMessage): Promise<void> {
    const next = this.operations.then(async () => {
      if (!this.closed) await this.handle(message);
    });
    this.operations = next.catch(() => undefined);
    await next;
  }

  private async handle(message: NetworkClientMessage): Promise<void> {
    switch (message.type) {
      case "debugGetPlayerIds":
        if (!this.coordinator.debugEnabled) {
          this.output({ type: "debugGetPlayerIdsRejected", requestId: message.requestId, reason: "debugDisabled" });
        } else {
          this.output({ type: "debugPlayerIds", requestId: message.requestId, playerIds: [...this.coordinator.connectedPlayerIds()] });
        }
        return;
      case "debugCreateBattle": {
        const reason = this.coordinator.createDebugBattle(this, message.requestId, message.playerIds);
        if (reason !== null) this.output({ type: "debugCreateBattleRejected", requestId: message.requestId, reason });
        return;
      }
      case "leaveBattle":
        this.leaveBattle(message.battleId, true);
        return;
      case "battleMessage": {
        const membership = this.memberships.get(message.battleId);
        if (membership === undefined) { this.failProtocol(); return; }
        if (message.message.type === "incrementCell" && message.message.playerId !== this.playerId) {
          this.failProtocol(); return;
        }
        await membership.battle.receive(this.playerId, message.message, (reply) => {
          if (!this.closed && this.memberships.has(message.battleId)) {
            this.output({ type: "battleMessage", battleId: message.battleId, message: reply });
          }
        });
      }
    }
  }

  attachBattle(
    battleId: BattleId,
    battle: HostedBattle,
    createRequestId: string | null,
  ): void {
    if (this.closed) return;
    const attachment = battle.attach((message) => {
      if (!this.closed && this.memberships.has(battleId)) {
        this.output({ type: "battleMessage", battleId, message });
      }
    });
    this.memberships.set(battleId, { battle, detach: attachment.detach });
    this.output({ type: "battleJoined", battleId, playerId: this.playerId, snapshot: attachment.snapshot, createRequestId });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const membership of this.memberships.values()) membership.detach();
    this.memberships.clear();
  }

  private leaveBattle(battleId: BattleId, acknowledge: boolean): void {
    const membership = this.memberships.get(battleId);
    if (membership === undefined) return;
    this.memberships.delete(battleId);
    membership.detach();
    if (acknowledge && !this.closed) this.output({ type: "battleLeft", battleId });
  }

  private failProtocol(): void {
    this.close();
    this.protocolViolation();
  }
}
