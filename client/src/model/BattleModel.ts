import type {
  BattleEvent,
  BattleSnapshot,
  ServerMessage,
} from "@grid-game/shared";

/** Details of the most recently rejected client command. */
export type BattleCommandRejection = Readonly<{
  requestId: string;
  reason: Extract<ServerMessage, { type: "commandRejected" }>['reason'];
}>;

/** Immutable observable state exposed to the battle view. */
export type BattleModelState = Readonly<{
  snapshot: BattleSnapshot | null;
  latestEvents: readonly BattleEvent[];
  lastRejection: BattleCommandRejection | null;
}>;

/** Listener notified after the model publishes a new state object. */
export type BattleModelListener = () => void;

const INITIAL_STATE: BattleModelState = {
  snapshot: null,
  latestEvents: [],
  lastRejection: null,
};

/**
 * Framework-independent observable model of authoritative battle state.
 *
 * `getSnapshot` and `subscribe` are stable arrow functions so they can be passed
 * directly to React's `useSyncExternalStore` without binding.
 */
export class BattleModel {
  private state: BattleModelState = INITIAL_STATE;
  private readonly listeners = new Set<BattleModelListener>();

  /** Returns the stable state object for the current model revision. */
  readonly getSnapshot = (): BattleModelState => this.state;

  /** Subscribes to state changes and returns an idempotent unsubscriber. */
  readonly subscribe = (listener: BattleModelListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Applies one validated authoritative message received by the controller. */
  applyAuthoritativeMessage(message: ServerMessage): void {
    switch (message.type) {
      case "battleSnapshot":
        this.publish({
          snapshot: message.snapshot,
          latestEvents: [],
          lastRejection: null,
        });
        break;
      case "commandAccepted":
        this.publish({
          snapshot: message.snapshot,
          latestEvents: message.events,
          lastRejection: null,
        });
        break;
      case "battleAdvanced":
        this.publish({
          snapshot: message.snapshot,
          latestEvents: message.events,
          // A clock heartbeat is unrelated to the rejected command. Keep the
          // feedback visible until the user acts again or state is replaced.
          lastRejection: this.state.lastRejection,
        });
        break;
      case "commandRejected":
        this.publish({
          ...this.state,
          latestEvents: [],
          lastRejection: {
            requestId: message.requestId,
            reason: message.reason,
          },
        });
        break;
    }
  }

  /** Clears transient command feedback without altering authoritative state. */
  clearRejection(): void {
    if (this.state.lastRejection === null) {
      return;
    }

    this.publish({ ...this.state, lastRejection: null });
  }

  private publish(state: BattleModelState): void {
    // Publish before notifying so every listener observes the same new revision.
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
