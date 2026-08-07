import type { ClientMessage, ServerMessage } from "@grid-game/shared";

/** Callback receiving validated authoritative messages from a battle session. */
export type BattleSessionListener = (message: ServerMessage) => void;

/**
 * Transport-neutral boundary used by the controller.
 *
 * A local simulation and a future WebSocket transport implement this same
 * contract, keeping transport and authority concerns out of the view model.
 */
export interface BattleSession {
  /** Starts delivery and emits an initial authoritative snapshot. */
  start(listener: BattleSessionListener): void;

  /** Sends one client protocol command to the session authority. */
  send(message: ClientMessage): void;

  /** Permanently releases timers, listeners, and transport resources. */
  dispose(): void;
}
