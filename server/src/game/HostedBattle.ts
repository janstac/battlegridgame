import {
  battleEventToServerMessages,
  type BattleCommand,
  type BattleEngine,
  type BattleSnapshot,
  type ClientMessage,
  type PlayerId,
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

/** Serialized, transport-free runtime for one authoritative battle. */
export class HostedBattle {
  private readonly engine: BattleEngine;
  private readonly clock: HostedBattleClock;
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private operations: Promise<void> = Promise.resolve();
  private timer: unknown | null = null;
  private disposed = false;

  constructor(engine: BattleEngine, clock: HostedBattleClock = SYSTEM_CLOCK) {
    this.engine = engine;
    this.clock = clock;
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

  start(): void {
    this.assertOpen();
    if (this.timer !== null || this.engine.status.kind === "finished") return;
    this.timer = this.clock.setInterval(
      () => { void this.enqueue(() => this.advance()); },
      1_000 / this.engine.getSnapshot().config.ticksPerSecond,
    );
  }

  async receive(
    playerId: PlayerId,
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
      const result = this.engine.applyCommand({ playerId }, command);
      if (!result.accepted) {
        reply({ type: "commandRejected", requestId: message.requestId, reason: result.reason });
        return;
      }
      for (const event of result.events) this.broadcastEvent(event, this.engine.currentTick);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    await this.operations;
  }

  private advance(): void {
    const result = this.engine.advanceTick();
    for (const event of result.events) this.broadcastEvent(event, result.tick);
    if (this.engine.status.kind === "finished") this.stop();
  }

  private broadcastEvent(event: Parameters<typeof battleEventToServerMessages>[0], tick: number): void {
    for (const message of battleEventToServerMessages(event, tick)) {
      for (const listener of [...this.listeners]) {
        try { listener(message); } catch { this.listeners.delete(listener); }
      }
    }
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
