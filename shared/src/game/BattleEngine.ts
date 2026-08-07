import type {
  BattleId,
  BattleSetup,
  BattleSnapshot,
  BattleStatus,
} from "../domain/index.ts";
import type { BattleConfig } from "./BattleConfig.ts";
import type { BattleCommand, CommandContext } from "./commands.ts";
import type { CooldownPolicy } from "./CooldownPolicy.ts";
import type { CommandResult, TickResult } from "./events.ts";

/** Authoritative deterministic simulation for a single isolated battle. */
export class BattleEngine {
  private constructor() {}

  /** Creates an engine after validating a new battle setup. */
  static create(
    setup: BattleSetup,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    void setup;
    void config;
    void cooldownPolicy;
    throw new Error("BattleEngine.create is not implemented yet");
  }

  /** Restores an engine from a complete authoritative snapshot. */
  static restore(
    snapshot: BattleSnapshot,
    config: BattleConfig,
    cooldownPolicy: CooldownPolicy,
  ): BattleEngine {
    void snapshot;
    void config;
    void cooldownPolicy;
    throw new Error("BattleEngine.restore is not implemented yet");
  }

  /** Identifier of the simulated battle. */
  get battleId(): BattleId {
    throw new Error("BattleEngine.battleId is not implemented yet");
  }

  /** Current logical simulation tick. */
  get currentTick(): number {
    throw new Error("BattleEngine.currentTick is not implemented yet");
  }

  /** Current running or finished lifecycle state. */
  get status(): BattleStatus {
    throw new Error("BattleEngine.status is not implemented yet");
  }

  /** Returns an independent plain-data snapshot of authoritative state. */
  getSnapshot(): BattleSnapshot {
    throw new Error("BattleEngine.getSnapshot is not implemented yet");
  }

  /** Validates and applies one command without advancing simulation time. */
  applyCommand(
    context: CommandContext,
    command: BattleCommand,
  ): CommandResult {
    void context;
    void command;
    throw new Error("BattleEngine.applyCommand is not implemented yet");
  }

  /** Advances one tick and resolves all splits due in stable queue order. */
  advanceTick(): TickResult {
    throw new Error("BattleEngine.advanceTick is not implemented yet");
  }
}
