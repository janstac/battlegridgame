import type {
  BattleCell,
  BattleSetup,
  BattleSnapshot,
  ClientMessage,
  ServerMessage,
} from "@grid-game/shared";

import type { LocalBattleClock } from "../src/session/LocalBattleSession.ts";
import type {
  BattleSession,
  BattleSessionListener,
} from "../src/session/BattleSession.ts";

/** First participant used by client lifecycle fixtures. */
export const ALPHA = "Alpha";

/** Second participant used by client lifecycle fixtures. */
export const BETA = "Beta";

/** Creates a small valid battle with one cell owned by each fixture player. */
export function createBattleSetup(battleId = "client-test"): BattleSetup {
  const cells: BattleCell[] = Array.from(
    { length: 6 },
    (): BattleCell => ({ kind: "empty" }),
  );
  cells[0] = { kind: "occupied", playerId: ALPHA, count: 1 };
  cells[5] = { kind: "occupied", playerId: BETA, count: 1 };
  return {
    battleId,
    players: [ALPHA, BETA],
    grid: { width: 3, height: 2, cells },
  };
}

/** Creates an authoritative snapshot suitable for model and controller tests. */
export function createBattleSnapshot(
  battleId = "client-test",
  tick = 0,
): BattleSnapshot {
  const setup = createBattleSetup(battleId);
  return {
    battleId,
    tick,
    revision: tick,
    status: { kind: "running" },
    players: [...setup.players],
    grid: {
      ...setup.grid,
      cells: setup.grid.cells.map((cell) => ({ ...cell })),
    },
    cooldowns: [],
    pendingSplits: [],
  };
}

/** Deterministic interval clock whose callbacks advance only when requested. */
export class ManualBattleClock implements LocalBattleClock {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 0;
  private clearedCount = 0;

  /** Number of interval callbacks currently registered. */
  get activeTimerCount(): number {
    return this.callbacks.size;
  }

  /** Number of active interval handles successfully cancelled. */
  get clearCount(): number {
    return this.clearedCount;
  }

  /** Registers an interval callback without starting real time. */
  setInterval(callback: () => void, _intervalMs: number): unknown {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  /** Removes a registered callback from the manual clock. */
  clearInterval(handle: unknown): void {
    if (typeof handle === "number" && this.callbacks.delete(handle)) {
      this.clearedCount += 1;
    }
  }

  /** Executes every active interval callback for a number of logical turns. */
  runTicks(count = 1): void {
    for (let tick = 0; tick < count; tick += 1) {
      // Snapshotting matches interval scheduling: mutations affect later turns.
      for (const callback of [...this.callbacks.values()]) {
        callback();
      }
    }
  }
}

/** In-memory session double recording controller lifecycle and commands. */
export class RecordingBattleSession implements BattleSession {
  readonly sent: ClientMessage[] = [];
  disposeCount = 0;
  private listener: BattleSessionListener | null = null;
  private readonly initialMessage: ServerMessage | null;

  /** Creates a session that may synchronously publish an initial message. */
  constructor(initialMessage: ServerMessage | null = null) {
    this.initialMessage = initialMessage;
  }

  /** Connects a listener and publishes the configured initial message. */
  start(listener: BattleSessionListener): void {
    this.listener = listener;
    if (this.initialMessage !== null) {
      listener(this.initialMessage);
    }
  }

  /** Records a command sent by the controller. */
  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  /** Records disposal and disconnects authoritative output. */
  dispose(): void {
    this.disposeCount += 1;
    this.listener = null;
  }

  /** Publishes an authoritative message to the connected controller. */
  emit(message: ServerMessage): void {
    this.listener?.(message);
  }
}
