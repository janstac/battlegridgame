import {
  ClientBattleState,
  type BattleEngineConnection,
  type ClientBattleStateOptions,
} from "@grid-game/client/headless";
import type { BattleParticipantId, RequestId } from "@grid-game/shared";

import type { Bot, BotBattleState } from "./Bot.ts";

export interface BotControllerClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CONTROLLER_CLOCK: BotControllerClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(
    handle as ReturnType<typeof setTimeout>,
  ),
};

export type BotBattleControllerOptions = Readonly<{
  clock?: BotControllerClock;
  clientState?: ClientBattleStateOptions;
  onError?: (error: Error) => void;
}>;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Drives one strategy only from authoritative notifications and one cooldown wake. */
export class BotBattleController {
  private readonly state: ClientBattleState;
  private readonly strategy: Bot;
  private readonly clock: BotControllerClock;
  private readonly onError: (error: Error) => void;
  private readonly unsubscribeConnection: () => void;
  private wakeTimer: unknown | null = null;
  private lastRejectionId: RequestId | null = null;
  private rejectionBackoffTick = 0;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(
    connection: BattleEngineConnection,
    localParticipantId: BattleParticipantId,
    strategy: Bot,
    options: BotBattleControllerOptions = {},
  ) {
    this.strategy = strategy;
    this.clock = options.clock ?? SYSTEM_CONTROLLER_CLOCK;
    this.onError = options.onError ?? (() => undefined);
    // ClientBattleState subscribes first and applies each authoritative fact.
    this.state = new ClientBattleState(
      connection,
      localParticipantId,
      options.clientState,
    );
    // This listener consequently observes the freshly projected state. It does
    // not subscribe to ClientBattleState's interpolation interval.
    this.unsubscribeConnection = connection.subscribe(() => this.reconcile());
    this.reconcile();
  }

  get view(): BotBattleState {
    const view = this.state.getSnapshot();
    return {
      snapshot: view.battle,
      localParticipantId: view.localParticipantId,
      estimatedTick: view.estimatedTick,
      hasLocalCommandPending: view.localCommandPending,
      latestRejection: view.lastRejection,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposePromise !== null) return await this.disposePromise;
    this.disposed = true;
    this.clearWake();
    this.unsubscribeConnection();
    this.disposePromise = this.state.dispose();
    return await this.disposePromise;
  }

  private reconcile(): void {
    if (this.disposed) return;
    this.clearWake();
    const state = this.view;
    const localParticipant = state.snapshot.participants.find(
      ({ participantId }) => participantId === state.localParticipantId,
    );
    if (
      state.snapshot.status.kind !== "running"
      || localParticipant?.status !== "active"
      || state.hasLocalCommandPending
    ) {
      return;
    }

    const rejectionId = state.latestRejection?.requestId ?? null;
    if (rejectionId !== null && rejectionId !== this.lastRejectionId) {
      this.lastRejectionId = rejectionId;
      this.rejectionBackoffTick = state.estimatedTick + 1;
    }
    const cooldownTick = state.snapshot.cooldowns.find(
      ({ participantId }) => participantId === state.localParticipantId,
    )?.nextActionTick ?? 0;
    const nextActionTick = Math.max(cooldownTick, this.rejectionBackoffTick);
    if (state.estimatedTick < nextActionTick) {
      this.scheduleWake(
        nextActionTick - state.estimatedTick,
        state.snapshot.config.ticksPerSecond,
      );
      return;
    }

    let action;
    try {
      action = this.strategy.decide(state);
    } catch (error) {
      this.onError(asError(error));
      return;
    }
    if (action === null) return;
    switch (action.type) {
      case "incrementCell":
        void this.state.increment(action.position).catch((error: unknown) => {
          if (!this.disposed) this.onError(asError(error));
        });
    }
  }

  private scheduleWake(remainingTicks: number, ticksPerSecond: number): void {
    const delayMs = Math.max(1, Math.ceil(remainingTicks * 1_000 / ticksPerSecond));
    this.wakeTimer = this.clock.setTimeout(() => {
      this.wakeTimer = null;
      this.reconcile();
    }, delayMs);
  }

  private clearWake(): void {
    if (this.wakeTimer === null) return;
    this.clock.clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }
}
