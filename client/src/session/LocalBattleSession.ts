import {
  BattleEngine,
  DEFAULT_BATTLE_CONFIG,
  FixedCooldownPolicy,
  type BattleConfig,
  type BattleSetup,
  type ClientMessage,
  type CooldownPolicy,
  type PlayerId,
  type ServerMessage,
} from "@grid-game/shared";

import type {
  BattleSession,
  BattleSessionListener,
} from "./BattleSession.ts";

/** Logical update frequency used by local demos and the future server. */
export const LOCAL_BATTLE_TICKS_PER_SECOND = 20;

/** Options for constructing a browser-local authoritative battle session. */
export type LocalBattleSessionOptions = Readonly<{
  setup: BattleSetup;
  playerId: PlayerId;
  config?: BattleConfig;
  cooldownPolicy?: CooldownPolicy;
  tickIntervalMs?: number;
}>;

/**
 * Browser-local authoritative session used by the standalone demo.
 *
 * It deliberately speaks the shared client/server protocol so replacing it
 * with a WebSocket session does not affect the model, controller, or views.
 */
export class LocalBattleSession implements BattleSession {
  private engine: BattleEngine;
  private playerId: PlayerId;
  private readonly config: BattleConfig;
  private readonly cooldownPolicy: CooldownPolicy;
  private readonly tickIntervalMs: number;
  private listener: BattleSessionListener | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  /** Creates a local authority without starting its simulation clock. */
  constructor(options: LocalBattleSessionOptions) {
    this.config = options.config ?? DEFAULT_BATTLE_CONFIG;
    this.cooldownPolicy =
      options.cooldownPolicy ?? new FixedCooldownPolicy(10);
    this.tickIntervalMs =
      options.tickIntervalMs ?? 1_000 / LOCAL_BATTLE_TICKS_PER_SECOND;
    this.assertTickInterval(this.tickIntervalMs);
    if (!options.setup.players.includes(options.playerId)) {
      throw new Error(`Unknown battle player: ${options.playerId}`);
    }
    this.playerId = options.playerId;
    this.engine = BattleEngine.create(
      options.setup,
      this.config,
      this.cooldownPolicy,
    );
  }

  /** Current demo player whose identity accompanies subsequent commands. */
  get activePlayerId(): PlayerId {
    return this.playerId;
  }

  /** Selects the demo player whose identity accompanies subsequent commands. */
  setActivePlayer(playerId: PlayerId): void {
    this.assertUsable();
    if (!this.engine.getSnapshot().players.includes(playerId)) {
      throw new Error(`Unknown battle player: ${playerId}`);
    }
    this.playerId = playerId;
  }

  /** Starts ticking and immediately delivers the initial snapshot. */
  start(listener: BattleSessionListener): void {
    this.assertUsable();
    if (this.listener !== null) {
      throw new Error("LocalBattleSession has already been started");
    }

    this.listener = listener;
    this.emit({
      type: "battleSnapshot",
      snapshot: this.engine.getSnapshot(),
    });
    this.startTimer();
  }

  /** Applies one protocol command and synchronously publishes its outcome. */
  send(message: ClientMessage): void {
    this.assertStarted();

    // A future server routes by battle ID; the local session owns exactly one.
    if (message.battleId !== this.engine.battleId) {
      throw new Error(`Unknown battle: ${message.battleId}`);
    }

    const result = this.engine.applyCommand(
      { playerId: this.playerId },
      { kind: "incrementCell", position: message.position },
    );

    if (result.accepted) {
      this.emit({
        type: "commandAccepted",
        requestId: message.requestId,
        events: result.events,
        snapshot: this.engine.getSnapshot(),
      });
      return;
    }

    this.emit({
      type: "commandRejected",
      requestId: message.requestId,
      battleId: message.battleId,
      reason: result.reason,
    });
  }

  /** Replaces the local battle and publishes a fresh initial snapshot. */
  reset(setup: BattleSetup, playerId: PlayerId = this.playerId): void {
    this.assertUsable();
    if (!setup.players.includes(playerId)) {
      throw new Error(`Unknown battle player: ${playerId}`);
    }
    this.engine = BattleEngine.create(
      setup,
      this.config,
      this.cooldownPolicy,
    );
    this.playerId = playerId;

    if (this.listener !== null) {
      this.emit({
        type: "battleSnapshot",
        snapshot: this.engine.getSnapshot(),
      });
      this.startTimer();
    }
  }

  /** Stops the simulation clock and permanently releases the listener. */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stopTimer();
    this.listener = null;
    this.disposed = true;
  }

  private advance(): void {
    const result = this.engine.advanceTick();
    const message: ServerMessage = {
      type: "battleAdvanced",
      events: result.events,
      snapshot: this.engine.getSnapshot(),
    };
    this.emit(message);
    if (this.engine.status.kind === "finished") {
      // A reset can restart the clock, but completed battles should stay still.
      this.stopTimer();
    }
  }

  private emit(message: ServerMessage): void {
    this.listener?.(message);
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("LocalBattleSession has been disposed");
    }
  }

  private assertStarted(): void {
    this.assertUsable();
    if (this.listener === null) {
      throw new Error("LocalBattleSession has not been started");
    }
  }

  private assertTickInterval(intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError("tickIntervalMs must be a positive finite number");
    }
  }

  private startTimer(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => this.advance(), this.tickIntervalMs);
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
