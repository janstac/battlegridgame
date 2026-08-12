import type { PlayerId } from "@grid-game/shared";
import type { ClientConnection } from "./ClientConnection.ts";

/** Tracks only currently live connections while never reusing allocated ids. */
export class PlayerDirectory {
  private readonly players = new Map<PlayerId, ClientConnection>();
  private nextSequence = 1;

  register(factory: (playerId: PlayerId) => ClientConnection): ClientConnection {
    const playerId = `player-${this.nextSequence++}`;
    const connection = factory(playerId);
    this.players.set(playerId, connection);
    return connection;
  }

  get(playerId: PlayerId): ClientConnection | undefined { return this.players.get(playerId); }
  playerIds(): readonly PlayerId[] { return [...this.players.keys()]; }
  remove(playerId: PlayerId, expected?: ClientConnection): void {
    if (expected !== undefined && this.players.get(playerId) !== expected) return;
    this.players.delete(playerId);
  }
}
