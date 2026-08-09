import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleConfig,
  type BattleEvent,
  type BattleStateMessage,
  type BattleSetup,
  type BattleSnapshot,
  type ClientMessage,
  type CooldownPolicy,
  type ServerMessage,
} from "@grid-game/shared";

import type {
  BattleEngineConnection,
  BattleEngineConnectionListener,
} from "./BattleEngineConnection.ts";

/** Replaceable interval clock used by the browser-local authority. */
export interface LocalBattleClock {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const SYSTEM_LOCAL_BATTLE_CLOCK: LocalBattleClock = {
  setInterval(callback, intervalMs) {
    return globalThis.setInterval(callback, intervalMs);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export type LocalBattleEngineConnectionOptions = Readonly<{
  setup: BattleSetup;
  config?: BattleConfig;
  cooldownPolicy?: CooldownPolicy;
  clock?: LocalBattleClock;
}>;

/** Async transport adapter around the browser-local deterministic engine. */
export class LocalBattleEngineConnection implements BattleEngineConnection {
  readonly initialSnapshot: BattleSnapshot;
  private readonly config: BattleConfig;
  private readonly cooldownPolicy: CooldownPolicy;
  private readonly clock: LocalBattleClock;
  private readonly listeners = new Set<BattleEngineConnectionListener>();
  private engine: BattleEngine;
  private timer: unknown | null = null;
  private operations: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(options: LocalBattleEngineConnectionOptions) {
    this.config = { ...(options.config ?? DEFAULT_BATTLE_CONFIG) };
    this.cooldownPolicy = options.cooldownPolicy ?? new FixedCooldownPolicy(10);
    this.clock = options.clock ?? SYSTEM_LOCAL_BATTLE_CLOCK;
    this.engine = BattleEngine.create(
      options.setup,
      this.config,
      this.cooldownPolicy,
    );
    this.initialSnapshot = this.engine.getSnapshot();
  }

  /** Creates the connection across an async boundary, like a remote handshake. */
  static async connect(
    options: LocalBattleEngineConnectionOptions,
  ): Promise<LocalBattleEngineConnection> {
    await Promise.resolve();
    return new LocalBattleEngineConnection(options);
  }

  subscribe(listener: BattleEngineConnectionListener): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    this.startTimer();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async send(message: ClientMessage): Promise<void> {
    this.assertOpen();
    await this.enqueue(async () => {
      switch (message.type) {
        case "incrementCell": {
          const result = this.engine.applyCommand(
            { playerId: message.playerId },
            { kind: "incrementCell", position: message.position },
          );
          if (!result.accepted) {
            this.emit({
              type: "commandRejected",
              requestId: message.requestId,
              reason: result.reason,
            });
            return;
          }
          for (const event of result.events) {
            this.emitEvent(event, this.engine.currentTick);
          }
          return;
        }
        case "tickProbe":
          this.emit({
            type: "tickProbeResult",
            probeId: message.probeId,
            tick: this.engine.currentTick,
          });
          return;
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.listeners.clear();
    await this.operations;
  }

  private async enqueue(operation: () => Promise<void> | void): Promise<void> {
    const next = this.operations.then(async () => {
      await Promise.resolve();
      if (!this.closed) await operation();
    });
    this.operations = next.catch(() => undefined);
    await next;
  }

  private advance(): void {
    void this.enqueue(() => {
      const result = this.engine.advanceTick();
      for (const event of result.events) {
        this.emitEvent(event, result.tick);
      }
      if (this.engine.status.kind === "finished") this.stopTimer();
    });
  }

  private emitEvent(event: BattleEvent, tick: number): void {
    if (event.kind === "battleWon") {
      this.emit({ type: "pendingSplitsCleared", tick });
    }
    this.emit(this.messageForEvent(event, tick));
  }

  private messageForEvent(event: BattleEvent, tick: number): BattleStateMessage {
    switch (event.kind) {
      case "cellIncremented":
        return {
          type: "cellIncremented",
          tick,
          position: { ...event.position },
          cell: {
            kind: "occupied",
            playerId: event.playerId,
            count: event.nextCount,
          },
          source: event.source,
        };
      case "cellCaptured":
        return {
          type: "cellCaptured",
          tick,
          position: { ...event.position },
          cell: {
            kind: "occupied",
            playerId: event.playerId,
            count: event.nextCount,
          },
        };
      case "splitScheduled":
        return {
          type: "splitScheduled",
          tick,
          split: {
            position: { ...event.position },
            dueTick: event.dueTick,
            sequence: event.sequence,
          },
        };
      case "cellSplit":
        return {
          type: "cellSplit",
          tick,
          position: { ...event.position },
          cell: { kind: "empty" },
        };
      case "cooldownStarted":
        return {
          type: "cooldownChanged",
          tick,
          cooldown: {
            playerId: event.playerId,
            nextActionTick: event.nextActionTick,
          },
        };
      case "battleWon":
        return {
          type: "battleStatusChanged",
          tick,
          status: { kind: "finished", winnerId: event.winnerId },
        };
    }
  }

  private emit(message: ServerMessage): void {
    for (const listener of [...this.listeners]) listener(message);
  }

  private startTimer(): void {
    if (this.timer !== null || this.closed) return;
    this.timer = this.clock.setInterval(
      () => this.advance(),
      1_000 / this.config.ticksPerSecond,
    );
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("BattleEngineConnection has been closed");
  }
}
