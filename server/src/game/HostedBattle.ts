import {
  battleEventToServerMessages,
  type BattleCommand,
  type BattleEngine,
  type BattleParticipantId,
  type BattleSnapshot,
  type ClientMessage,
  type HostedParticipant,
  type PlayerId,
  type Position,
  type ServerMessage,
} from "@grid-game/shared";

export interface HostedBattleClock {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const SYSTEM_CLOCK: HostedBattleClock = {
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as NodeJS.Timeout),
};

export type HostedBattleAttachment = Readonly<{
  snapshot: BattleSnapshot;
  detach(): void;
}>;

export type HostedBattleOptions = Readonly<{
  clock?: HostedBattleClock;
  worldPosition?: Position | null;
}>;

export type HostedBattleTerminalResult = Readonly<{
  winnerParticipantId: BattleParticipantId | null;
  winnerPlayerId: PlayerId | null;
  worldPosition: Position | null;
}>;

type HostedBattleTerminalListener = (result: HostedBattleTerminalResult) => void;
type HostedBattleCapacityReleaseListener = () => void;

/** Serialized, transport-free runtime for one authoritative battle. */
export class HostedBattle {
  private readonly engine: BattleEngine;
  private readonly clock: HostedBattleClock;
  private readonly participantToPlayer = new Map<BattleParticipantId, PlayerId>();
  private readonly playerToParticipant = new Map<PlayerId, BattleParticipantId>();
  private readonly orderedParticipantIds: readonly BattleParticipantId[];
  private readonly hostedWorldPosition: Position | null;
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly terminalListeners = new Set<HostedBattleTerminalListener>();
  private readonly capacityReleaseListeners =
    new Set<HostedBattleCapacityReleaseListener>();
  private operations: Promise<void> = Promise.resolve();
  private timer: unknown | null = null;
  private terminalResult: HostedBattleTerminalResult | undefined;
  private disposed = false;

  constructor(
    engine: BattleEngine,
    roster: readonly Readonly<{
      participantId: BattleParticipantId;
      playerId: PlayerId;
    }>[],
    options: HostedBattleOptions = {},
  ) {
    this.engine = engine;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.hostedWorldPosition = options.worldPosition == null
      ? null
      : { ...options.worldPosition };

    const engineParticipantIds = new Set(
      engine.getSnapshot().participants.map(({ participantId }) => participantId),
    );
    for (const entry of roster) {
      if (this.participantToPlayer.has(entry.participantId)) {
        throw new Error(`Duplicate hosted participant ${entry.participantId}`);
      }
      if (this.playerToParticipant.has(entry.playerId)) {
        throw new Error(`Player ${entry.playerId} appears more than once in the battle`);
      }
      this.participantToPlayer.set(entry.participantId, entry.playerId);
      this.playerToParticipant.set(entry.playerId, entry.participantId);
    }
    if (
      this.participantToPlayer.size !== engineParticipantIds.size ||
      [...this.participantToPlayer.keys()].some(
        (participantId) => !engineParticipantIds.has(participantId),
      )
    ) {
      throw new Error("Hosted roster must map every engine participant exactly once");
    }
    this.orderedParticipantIds = Object.freeze(
      roster.map(({ participantId }) => participantId),
    );
  }

  get worldPosition(): Position | null {
    return this.hostedWorldPosition === null
      ? null
      : { ...this.hostedWorldPosition };
  }

  get snapshot(): BattleSnapshot {
    return this.engine.getSnapshot();
  }

  getRoster(): readonly HostedParticipant[] {
    const participants = new Map(
      this.engine.getSnapshot().participants.map((participant) => [
        participant.participantId,
        participant,
      ]),
    );
    return this.orderedParticipantIds.map((participantId) => {
      const participant = participants.get(participantId);
      const playerId = this.participantToPlayer.get(participantId);
      if (participant === undefined || playerId === undefined) {
        throw new Error(`Hosted participant ${participantId} is inconsistent`);
      }
      return { participantId, playerId, status: participant.status };
    });
  }

  participantIdForPlayer(playerId: PlayerId): BattleParticipantId | undefined {
    return this.playerToParticipant.get(playerId);
  }

  playerIdForParticipant(participantId: BattleParticipantId): PlayerId | undefined {
    return this.participantToPlayer.get(participantId);
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.playerToParticipant.has(playerId);
  }

  attach(listener: (message: ServerMessage) => void): HostedBattleAttachment {
    this.assertOpen();
    const snapshot = this.engine.getSnapshot();
    this.listeners.add(listener);
    let attached = true;
    return {
      snapshot,
      detach: () => {
        if (!attached) return;
        attached = false;
        this.listeners.delete(listener);
      },
    };
  }

  /** Registers a callback that is invoked once for this battle's terminal outcome. */
  onTerminal(listener: HostedBattleTerminalListener): () => void {
    this.assertOpen();
    if (this.terminalResult !== undefined) {
      this.invokeTerminalListener(listener, this.terminalResult);
      return () => undefined;
    }
    this.terminalListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.terminalListeners.delete(listener);
    };
  }

  /** Observes a roster member changing from active to withdrawn or eliminated. */
  onCapacityReleased(listener: HostedBattleCapacityReleaseListener): () => void {
    this.assertOpen();
    this.capacityReleaseListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.capacityReleaseListeners.delete(listener);
    };
  }

  start(): void {
    this.assertOpen();
    if (this.engine.status.kind === "finished") {
      this.notifyTerminal();
      return;
    }
    if (this.timer !== null) return;
    this.timer = this.clock.setInterval(
      () => { void this.enqueue(() => this.advance()); },
      1_000 / this.engine.getSnapshot().config.ticksPerSecond,
    );
  }

  async receive(
    participantId: BattleParticipantId,
    message: ClientMessage,
    reply: (message: ServerMessage) => void,
  ): Promise<void> {
    this.assertOpen();
    await this.enqueue(() => {
      if (message.type === "tickProbe") {
        reply({ type: "tickProbeResult", probeId: message.probeId, tick: this.engine.currentTick });
        return;
      }
      const command: BattleCommand = { kind: "incrementCell", position: message.position };
      const result = this.engine.applyCommand({ participantId }, command);
      if (!result.accepted) {
        reply({ type: "commandRejected", requestId: message.requestId, reason: result.reason });
        return;
      }
      this.broadcastEvents(result.events, this.engine.currentTick);
      this.notifyTerminal();
    });
  }

  /** Withdraws a participant in the same operation queue as commands and ticks. */
  async withdraw(participantId: BattleParticipantId): Promise<void> {
    this.assertOpen();
    await this.enqueue(() => {
      const events = this.engine.withdrawParticipant(participantId);
      this.broadcastEvents(events, this.engine.currentTick);
      this.notifyTerminal();
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.terminalListeners.clear();
    this.capacityReleaseListeners.clear();
    await this.operations;
  }

  private advance(): void {
    const result = this.engine.advanceTick();
    this.broadcastEvents(result.events, result.tick);
    this.notifyTerminal();
  }

  private broadcastEvents(
    events: readonly Parameters<typeof battleEventToServerMessages>[0][],
    tick: number,
  ): void {
    for (const event of events) this.broadcastEvent(event, tick);
    if (events.some((event) =>
      event.kind === "participantStatusChanged" && event.status !== "active"
    )) {
      for (const listener of [...this.capacityReleaseListeners]) {
        try { listener(); } catch { /* Capacity observers cannot corrupt simulation. */ }
      }
    }
  }

  private broadcastEvent(event: Parameters<typeof battleEventToServerMessages>[0], tick: number): void {
    for (const message of battleEventToServerMessages(event, tick)) {
      for (const listener of [...this.listeners]) {
        try { listener(message); } catch { this.listeners.delete(listener); }
      }
    }
  }

  private notifyTerminal(): void {
    if (this.terminalResult !== undefined || this.engine.status.kind !== "finished") return;
    this.stop();
    const winnerParticipantId = this.engine.status.winnerId;
    const winnerPlayerId = winnerParticipantId === null
      ? null
      : this.participantToPlayer.get(winnerParticipantId);
    if (winnerParticipantId !== null && winnerPlayerId === undefined) {
      throw new Error(`Terminal winner ${winnerParticipantId} is not hosted`);
    }
    const result: HostedBattleTerminalResult = Object.freeze({
      winnerParticipantId,
      winnerPlayerId: winnerPlayerId ?? null,
      worldPosition: this.hostedWorldPosition === null
        ? null
        : Object.freeze({ ...this.hostedWorldPosition }),
    });
    this.terminalResult = result;
    const listeners = [...this.terminalListeners];
    this.terminalListeners.clear();
    for (const listener of listeners) this.invokeTerminalListener(listener, result);
  }

  private invokeTerminalListener(
    listener: HostedBattleTerminalListener,
    result: HostedBattleTerminalResult,
  ): void {
    try { listener(result); } catch { /* Terminal observers cannot corrupt simulation. */ }
  }

  private async enqueue(operation: () => void): Promise<void> {
    const next = this.operations.then(() => {
      if (!this.disposed) operation();
    });
    this.operations = next.catch(() => undefined);
    await next;
  }

  private stop(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("HostedBattle has been disposed");
  }
}
