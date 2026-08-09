import type {
  BattleSnapshot,
  ClientMessage,
  ServerMessage,
} from "@grid-game/shared";

export type BattleEngineConnectionListener = (message: ServerMessage) => void;

/** Async, battle-local boundary implemented by a local or future remote engine. */
export interface BattleEngineConnection {
  /** Atomically captured before any subscribed incremental message can arrive. */
  readonly initialSnapshot: BattleSnapshot;

  subscribe(listener: BattleEngineConnectionListener): () => void;
  send(message: ClientMessage): Promise<void>;
  close(): Promise<void>;
}
