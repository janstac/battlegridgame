import type {
  BattleCell,
  BattleSetup,
  BattleSnapshot,
  ClientMessage,
  ServerMessage,
} from "@grid-game/shared";
import type { ClientBattleClock } from "../src/model/index.ts";
import type { BattleEngineConnection } from "../src/session/index.ts";

export const ALPHA = 0;
export const BETA = 1;

export function createBattleSetup(): BattleSetup {
  const cells: BattleCell[] = Array.from(
    { length: 6 },
    (): BattleCell => ({ kind: "empty" }),
  );
  cells[0] = { kind: "occupied", participantId: ALPHA, count: 1 };
  cells[5] = { kind: "occupied", participantId: BETA, count: 1 };
  return {
    participants: [
      { participantId: ALPHA, status: "active" },
      { participantId: BETA, status: "active" },
    ],
    grid: { width: 3, height: 2, cells },
  };
}

export function createBattleSnapshot(tick = 0): BattleSnapshot {
  const setup = createBattleSetup();
  return {
    config: { ticksPerSecond: 20, splitDelayTicks: 10 },
    tick,
    status: { kind: "running" },
    participants: setup.participants.map((participant) => ({ ...participant })),
    grid: { ...setup.grid, cells: setup.grid.cells.map((cell) => ({ ...cell })) },
    cooldowns: [],
    pendingSplits: [],
  };
}

export class ManualBattleClock implements ClientBattleClock {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 0;
  private currentTime = 0;
  private clearedCount = 0;

  get activeTimerCount(): number { return this.callbacks.size; }
  get clearCount(): number { return this.clearedCount; }
  now(): number { return this.currentTime; }
  setInterval(callback: () => void, _intervalMs: number): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }
  clearInterval(handle: unknown): void {
    if (typeof handle === "number" && this.callbacks.delete(handle)) {
      this.clearedCount += 1;
    }
  }
  runTicks(count = 1, elapsedMs = 50): void {
    for (let tick = 0; tick < count; tick += 1) {
      this.currentTime += elapsedMs;
      for (const callback of [...this.callbacks.values()]) callback();
    }
  }
}

export class RecordingBattleEngineConnection implements BattleEngineConnection {
  readonly sent: ClientMessage[] = [];
  readonly initialSnapshot: BattleSnapshot;
  closeCount = 0;
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  constructor(snapshot = createBattleSnapshot()) {
    this.initialSnapshot = snapshot;
  }
  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async send(message: ClientMessage): Promise<void> {
    await Promise.resolve();
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
