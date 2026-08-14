import type {
  BattleCell,
  BattleParticipantId,
  BattleSnapshot,
  ClientMessage,
  ServerMessage,
} from "@grid-game/shared";
import type {
  BattleEngineConnection,
  ClientBattleClock,
} from "@grid-game/client/headless";

import type { BotBattleState } from "../src/Bot.ts";
import type { BotControllerClock } from "../src/BotBattleController.ts";

export const ALPHA = 0;
export const BETA = 1;

export function createBattleSnapshot(options: Readonly<{
  tick?: number;
  cells?: BattleCell[];
  localStatus?: "active" | "withdrawn" | "eliminated";
}> = {}): BattleSnapshot {
  return {
    config: { ticksPerSecond: 20, splitDelayTicks: 10 },
    tick: options.tick ?? 0,
    status: { kind: "running" },
    participants: [
      { participantId: ALPHA, status: options.localStatus ?? "active" },
      { participantId: BETA, status: "active" },
    ],
    grid: {
      width: 3,
      height: 2,
      cells: options.cells ?? [
        { kind: "occupied", participantId: ALPHA, count: 1 },
        { kind: "empty" },
        { kind: "wall" },
        { kind: "occupied", participantId: ALPHA, count: 2 },
        { kind: "occupied", participantId: BETA, count: 1 },
        { kind: "empty" },
      ],
    },
    cooldowns: [],
    pendingSplits: [],
  };
}

export function createBotState(
  snapshot = createBattleSnapshot(),
  localParticipantId: BattleParticipantId = ALPHA,
): BotBattleState {
  return {
    snapshot,
    localParticipantId,
    estimatedTick: snapshot.tick,
    hasLocalCommandPending: false,
    latestRejection: null,
  };
}

type Scheduled = {
  callback: () => void;
  at: number;
  interval: number | null;
};

export class ManualBotClock implements ClientBattleClock, BotControllerClock {
  private readonly scheduled = new Map<number, Scheduled>();
  private nextHandle = 0;
  private time = 0;

  get activeTimeoutCount(): number {
    return [...this.scheduled.values()].filter(({ interval }) => interval === null).length;
  }

  now(): number { return this.time; }

  setInterval(callback: () => void, intervalMs: number): unknown {
    const handle = this.nextHandle++;
    this.scheduled.set(handle, {
      callback,
      at: this.time + intervalMs,
      interval: intervalMs,
    });
    return handle;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === "number") this.scheduled.delete(handle);
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.scheduled.set(handle, {
      callback,
      at: this.time + delayMs,
      interval: null,
    });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.scheduled.delete(handle);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextAt = Number.POSITIVE_INFINITY;
      for (const entry of this.scheduled.values()) nextAt = Math.min(nextAt, entry.at);
      if (nextAt > target) break;
      this.time = nextAt;
      const due = [...this.scheduled.entries()].filter(([, entry]) => entry.at === nextAt);
      for (const [handle, entry] of due) {
        if (!this.scheduled.has(handle)) continue;
        if (entry.interval === null) this.scheduled.delete(handle);
        else entry.at += entry.interval;
        entry.callback();
      }
    }
    this.time = target;
  }
}

export class RecordingConnection implements BattleEngineConnection {
  readonly initialSnapshot: BattleSnapshot;
  readonly sent: ClientMessage[] = [];
  closeCount = 0;
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  constructor(snapshot = createBattleSnapshot()) {
    this.initialSnapshot = structuredClone(snapshot);
  }

  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(message: ClientMessage): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.listeners.clear();
  }

  emit(message: ServerMessage): void {
    for (const listener of [...this.listeners]) listener(message);
  }
}
