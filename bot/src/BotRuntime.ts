import type {
  BattleEngineConnection,
  NetworkClient,
  NetworkClientEvent,
  NetworkBattleSession,
} from "@grid-game/client/headless";
import type { BattleId, BattleParticipantId, PlayerId } from "@grid-game/shared";

import type { Bot, BotFactory } from "./Bot.ts";
import {
  BotBattleController,
  type BotBattleControllerOptions,
} from "./BotBattleController.ts";

export type BotRuntimeResult = Readonly<{
  reason: "client" | "socket" | "error";
  error: Error | null;
}>;

export type BotRuntimeSession = BattleEngineConnection & Readonly<{
  battleId: BattleId;
  localParticipantId: BattleParticipantId;
}>;

export interface BotRuntimeClient {
  readonly playerId: PlayerId;
  subscribe(listener: (event: NetworkClientEvent) => void): () => void;
  getSessions(): readonly NetworkBattleSession[];
  close(): Promise<void>;
}

export type BotController = Readonly<{ dispose(): Promise<void> }>;

export type BotRuntimeOptions = Readonly<{
  controller?: BotBattleControllerOptions;
  createController?: (
    session: BotRuntimeSession,
    bot: Bot,
    onError: (error: Error) => void,
  ) => BotController;
}>;

/** Owns one independent controller for every battle joined by one player. */
export class BotRuntime {
  readonly done: Promise<BotRuntimeResult>;
  private readonly client: BotRuntimeClient;
  private readonly factory: BotFactory;
  private readonly options: BotRuntimeOptions;
  private readonly controllers = new Map<BattleId, BotController>();
  private readonly pendingDisposals = new Set<Promise<void>>();
  private readonly resolveDone: (result: BotRuntimeResult) => void;
  private unsubscribeClient: () => void = () => undefined;
  private shutdownPromise: Promise<BotRuntimeResult> | null = null;
  private stopped = false;

  constructor(
    client: NetworkClient | BotRuntimeClient,
    factory: BotFactory,
    options: BotRuntimeOptions = {},
  ) {
    this.client = client;
    this.factory = factory;
    this.options = options;
    let resolveDone!: (result: BotRuntimeResult) => void;
    this.done = new Promise((resolve) => { resolveDone = resolve; });
    this.resolveDone = resolveDone;

    // Subscribe before reconciling so a racing join is either observed here or
    // present in getSessions(); attach is idempotent across both paths.
    this.unsubscribeClient = client.subscribe((event) => this.receive(event));
    for (const session of client.getSessions()) this.attach(session);
  }

  get controllerCount(): number {
    return this.controllers.size;
  }

  async stop(): Promise<BotRuntimeResult> {
    return await this.shutdown({ reason: "client", error: null }, true);
  }

  private receive(event: NetworkClientEvent): void {
    if (this.stopped) return;
    switch (event.type) {
      case "battleJoined":
        this.attach(event.session);
        return;
      case "battleLeft":
        this.detach(event.battleId);
        return;
      case "connectionClosed":
        void this.shutdown({ reason: event.reason, error: event.error }, false);
    }
  }

  private attach(session: BotRuntimeSession): void {
    if (this.stopped || this.controllers.has(session.battleId)) return;
    try {
      const bot = this.factory({
        battleId: session.battleId,
        localParticipantId: session.localParticipantId,
      });
      const fail = (error: Error) => {
        void this.shutdown({ reason: "error", error }, true);
      };
      const controller = this.options.createController?.(session, bot, fail)
        ?? new BotBattleController(session, session.localParticipantId, bot, {
          ...this.options.controller,
          onError: fail,
        });
      this.controllers.set(session.battleId, controller);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      void this.shutdown({ reason: "error", error: failure }, true);
    }
  }

  private detach(battleId: BattleId): void {
    const controller = this.controllers.get(battleId);
    if (controller === undefined) return;
    this.controllers.delete(battleId);
    const disposal = controller.dispose();
    this.pendingDisposals.add(disposal);
    void disposal.then(() => {
      this.pendingDisposals.delete(disposal);
    }, (error: unknown) => {
      // Keep the rejected promise tracked until shutdown has observed it.
      const failure = error instanceof Error ? error : new Error(String(error));
      void this.shutdown({ reason: "error", error: failure }, true);
    });
  }

  private shutdown(
    result: BotRuntimeResult,
    closeClient: boolean,
  ): Promise<BotRuntimeResult> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.stopped = true;
    this.unsubscribeClient();
    this.shutdownPromise = (async () => {
      let completedResult = result;
      if (closeClient) {
        try {
          await this.client.close();
        } catch (error) {
          completedResult = {
            reason: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }
      const controllers = [...this.controllers.values()];
      this.controllers.clear();
      const disposals = [
        ...this.pendingDisposals,
        ...controllers.map(async (controller) => controller.dispose()),
      ];
      const outcomes = await Promise.allSettled(disposals);
      const failedDisposal = outcomes.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      if (failedDisposal !== undefined && completedResult.error === null) {
        completedResult = {
          reason: "error",
          error: failedDisposal.reason instanceof Error
            ? failedDisposal.reason
            : new Error(String(failedDisposal.reason)),
        };
      }
      this.resolveDone(completedResult);
      return completedResult;
    })();
    return this.shutdownPromise;
  }
}
