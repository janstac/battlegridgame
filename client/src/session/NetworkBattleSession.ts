import type {
  BattleId,
  BattleParticipantId,
  BattleSnapshot,
  ClientMessage,
  HostedParticipant,
  Position,
  ServerMessage,
} from "@grid-game/shared";
import type {
  BattleEngineConnection,
  BattleEngineConnectionListener,
} from "./BattleEngineConnection.ts";
import type { NetworkClient } from "./NetworkClient.ts";

export class NetworkBattleSession implements BattleEngineConnection {
  readonly initialSnapshot: BattleSnapshot;
  readonly battleId: BattleId;
  readonly localParticipantId: BattleParticipantId;
  readonly roster: readonly HostedParticipant[];
  readonly worldPosition: Position | null;
  private readonly client: NetworkClient;
  private readonly listeners = new Set<BattleEngineConnectionListener>();
  private readonly buffered: ServerMessage[] = [];
  private closed = false;
  private subscribed = false;

  constructor(
    client: NetworkClient,
    battleId: BattleId,
    localParticipantId: BattleParticipantId,
    roster: readonly HostedParticipant[],
    worldPosition: Position | null,
    snapshot: BattleSnapshot,
  ) {
    this.client = client;
    this.battleId = battleId;
    this.localParticipantId = localParticipantId;
    this.roster = roster.map((participant) => ({ ...participant }));
    this.worldPosition = worldPosition === null ? null : { ...worldPosition };
    this.initialSnapshot = structuredClone(snapshot);
    if (!snapshot.participants.some(
      ({ participantId }) => participantId === localParticipantId,
    )) {
      throw new Error(`Unknown local battle participant: ${localParticipantId}`);
    }
  }

  subscribe(listener: BattleEngineConnectionListener): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    if (!this.subscribed) {
      this.subscribed = true;
      for (const message of this.buffered.splice(0)) listener(message);
    }
    return () => this.listeners.delete(listener);
  }

  async send(message: ClientMessage): Promise<void> {
    this.assertOpen();
    await this.client.sendBattleMessage(this.battleId, message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.client.leaveBattle(this.battleId);
  }

  /** @internal Routes a validated server fact from the parent socket. */
  receive(message: ServerMessage): void {
    if (this.closed) return;
    if (!this.subscribed) {
      this.buffered.push(message);
      return;
    }
    for (const listener of [...this.listeners]) listener(message);
  }

  /** @internal Completes server-acknowledged leave or parent shutdown. */
  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffered.length = 0;
    this.listeners.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("NetworkBattleSession has been closed");
  }
}
