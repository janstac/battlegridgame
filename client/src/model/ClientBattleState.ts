import {
  BattleState,
  applyBattleServerMessage,
  type BattleParticipantId,
  type BattleSnapshot,
  type CommandRejectionReason,
  type Position,
  type RequestId,
  type ServerMessage,
} from "@grid-game/shared";

import type { BattleEngineConnection } from "../session/index.ts";

export type BattleCommandRejection = Readonly<{
  requestId: RequestId;
  reason: CommandRejectionReason;
}>;

/** Stable immutable projection consumed by React via useSyncExternalStore. */
export type ClientBattleViewState = Readonly<{
  battle: BattleSnapshot;
  localParticipantId: BattleParticipantId;
  estimatedTick: number;
  lastRejection: BattleCommandRejection | null;
}>;

export type RequestIdFactory = () => RequestId;

export interface ClientBattleClock {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const SYSTEM_CLIENT_BATTLE_CLOCK: ClientBattleClock = {
  now: () => performance.now(),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(
    handle as ReturnType<typeof setInterval>,
  ),
};

export type ClientBattleStateOptions = Readonly<{
  requestIdFactory?: RequestIdFactory;
  clock?: ClientBattleClock;
  probeIntervalMs?: number;
}>;

let nextClientStateId = 0;

function defaultRequestIdFactory(): RequestIdFactory {
  const stateId = nextClientStateId++;
  let sequence = 0;
  return () => `battle-${stateId}-${sequence++}`;
}

/**
 * Observable client projection of authoritative battle facts.
 *
 * It owns transport, local identity, tick estimation, and transient feedback,
 * but contains no game-rule decisions.
 */
export class ClientBattleState {
  private battle: BattleState;
  private readonly participantId: BattleParticipantId;
  private readonly connection: BattleEngineConnection;
  private readonly requestIdFactory: RequestIdFactory;
  private readonly clock: ClientBattleClock;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeConnection: () => void;
  private readonly updateTimer: unknown;
  private readonly probeIntervalMs: number;
  private viewState: ClientBattleViewState;
  private rejection: BattleCommandRejection | null = null;
  private anchorTick: number;
  private anchorTime: number;
  private lastEstimatedTick: number;
  private readonly probes = new Map<RequestId, number>();
  private disposed = false;

  constructor(
    connection: BattleEngineConnection,
    localParticipantId: BattleParticipantId,
    options: ClientBattleStateOptions = {},
  ) {
    this.connection = connection;
    this.battle = BattleState.restore(connection.initialSnapshot);
    if (this.battle.participant(localParticipantId) === undefined) {
      throw new Error(`Unknown battle participant: ${localParticipantId}`);
    }
    this.participantId = localParticipantId;
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory();
    this.clock = options.clock ?? SYSTEM_CLIENT_BATTLE_CLOCK;
    this.probeIntervalMs = options.probeIntervalMs ?? 1_000;
    if (!Number.isFinite(this.probeIntervalMs) || this.probeIntervalMs <= 0) {
      throw new RangeError("probeIntervalMs must be a positive finite number");
    }
    this.anchorTick = this.battle.tick;
    this.anchorTime = this.clock.now();
    this.lastEstimatedTick = this.battle.tick;
    this.viewState = this.createViewState();
    // The connection contract captures initialSnapshot before incremental
    // delivery; subscribing here therefore cannot leave an initialization gap.
    this.unsubscribeConnection = connection.subscribe((message) => {
      this.receive(message);
    });
    const refreshMs = Math.min(
      this.probeIntervalMs,
      1_000 / this.battle.config.ticksPerSecond,
    );
    let nextProbeTime = this.clock.now() + this.probeIntervalMs;
    this.updateTimer = this.clock.setInterval(() => {
      if (this.disposed) return;
      const estimatedTick = this.estimateTick();
      if (estimatedTick !== this.viewState.estimatedTick) this.publish();
      const now = this.clock.now();
      if (now >= nextProbeTime) {
        nextProbeTime = now + this.probeIntervalMs;
        void this.sendProbe();
      }
    }, refreshMs);
  }

  readonly getSnapshot = (): ClientBattleViewState => this.viewState;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get localParticipantId(): BattleParticipantId {
    return this.participantId;
  }

  async increment(position: Position): Promise<RequestId> {
    this.assertUsable();
    const requestId = this.requestIdFactory();
    this.clearRejection();
    await this.connection.send({
      type: "incrementCell",
      requestId,
      position: { ...position },
    });
    return requestId;
  }

  clearRejection(): void {
    if (this.rejection === null) return;
    this.rejection = null;
    this.publish();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.clearInterval(this.updateTimer);
    this.unsubscribeConnection();
    this.listeners.clear();
    await this.connection.close();
  }

  private receive(message: ServerMessage): void {
    if (this.disposed) return;
    if (message.type === "commandRejected") {
      this.rejection = {
        requestId: message.requestId,
        reason: message.reason,
      };
      this.publish();
      return;
    }
    if (message.type === "tickProbeResult") {
      const sentAt = this.probes.get(message.probeId);
      if (sentAt === undefined) return;
      this.probes.delete(message.probeId);
      const receivedAt = this.clock.now();
      if (message.tick >= this.battle.tick) {
        this.battle.setTick(message.tick);
        this.setTickAnchor(message.tick, (sentAt + receivedAt) / 2);
        this.publish();
      }
      return;
    }

    this.battle = applyBattleServerMessage(this.battle, message);
    if (message.type === "battleSnapshot") {
      this.rejection = null;
      this.lastEstimatedTick = this.battle.tick;
    }
    this.setTickAnchor(this.battle.tick, this.clock.now());
    this.publish();
  }

  private async sendProbe(): Promise<void> {
    const probeId = this.requestIdFactory();
    this.probes.set(probeId, this.clock.now());
    try {
      await this.connection.send({ type: "tickProbe", probeId });
    } catch {
      this.probes.delete(probeId);
    }
  }

  private setTickAnchor(tick: number, time: number): void {
    this.anchorTick = tick;
    this.anchorTime = time;
    this.lastEstimatedTick = Math.max(this.lastEstimatedTick, tick);
  }

  private estimateTick(): number {
    if (this.battle.status.kind === "finished") return this.battle.tick;
    const elapsed = Math.max(0, this.clock.now() - this.anchorTime);
    const estimate = Math.floor(
      this.anchorTick + elapsed * this.battle.config.ticksPerSecond / 1_000,
    );
    this.lastEstimatedTick = Math.max(this.lastEstimatedTick, estimate);
    return this.lastEstimatedTick;
  }

  private createViewState(): ClientBattleViewState {
    return {
      battle: this.battle.toSnapshot(),
      localParticipantId: this.participantId,
      estimatedTick: this.estimateTick(),
      lastRejection: this.rejection,
    };
  }

  private publish(): void {
    this.viewState = this.createViewState();
    for (const listener of [...this.listeners]) listener();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("ClientBattleState has been disposed");
  }
}
