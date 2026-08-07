import type { Position, RequestId } from "@grid-game/shared";

import type { BattleModel } from "../model/BattleModel.ts";
import type { BattleSession } from "../session/BattleSession.ts";

/** Produces unique request IDs for commands created by a controller. */
export type RequestIdFactory = () => RequestId;

/** Options controlling command correlation in a battle controller. */
export type BattleControllerOptions = Readonly<{
  requestIdFactory?: RequestIdFactory;
}>;

let nextControllerId = 0;

function createDefaultRequestIdFactory(): RequestIdFactory {
  const controllerId = nextControllerId++;
  let sequence = 0;
  return () => `battle-${controllerId}-${sequence++}`;
}

/** Coordinates view intents, a transport-neutral session, and the view model. */
export class BattleController {
  private readonly model: BattleModel;
  private readonly session: BattleSession;
  private readonly requestIdFactory: RequestIdFactory;
  private started = false;
  private disposed = false;

  /** Creates a controller without starting its session. */
  constructor(
    model: BattleModel,
    session: BattleSession,
    options: BattleControllerOptions = {},
  ) {
    this.model = model;
    this.session = session;
    this.requestIdFactory =
      options.requestIdFactory ?? createDefaultRequestIdFactory();
  }

  /** Starts the underlying session and authoritative message flow. */
  start(): void {
    this.assertUsable();
    if (this.started) {
      throw new Error("BattleController has already been started");
    }

    this.session.start((message) => {
      // The model only ever sees the session's authoritative protocol output.
      this.model.applyAuthoritativeMessage(message);
    });
    this.started = true;
  }

  /** Sends an increment intent for a grid position and returns its request ID. */
  incrementCell(position: Position): RequestId {
    this.assertStarted();
    const snapshot = this.model.getSnapshot().snapshot;
    if (snapshot === null) {
      throw new Error("Cannot send a command before receiving a battle snapshot");
    }

    const requestId = this.requestIdFactory();
    this.model.clearRejection();
    this.session.send({
      type: "incrementCell",
      requestId,
      battleId: snapshot.battleId,
      position,
    });
    return requestId;
  }

  /** Clears the model's most recent command-rejection notice. */
  clearRejection(): void {
    this.model.clearRejection();
  }

  /** Permanently disposes the controller and its current session. */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.session.dispose();
    this.disposed = true;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("BattleController has been disposed");
    }
  }

  private assertStarted(): void {
    this.assertUsable();
    if (!this.started) {
      throw new Error("BattleController has not been started");
    }
  }
}
