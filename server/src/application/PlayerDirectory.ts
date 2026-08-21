import { randomBytes } from "node:crypto";
import type { PlayerId, ResumeToken } from "@grid-game/shared";
import type { ClientConnection } from "./ClientConnection.ts";

/** Tracks logical player sessions by player id and opaque resume token. */
export class PlayerDirectory {
  private readonly players = new Map<PlayerId, ClientConnection>();
  private readonly byResumeToken = new Map<ResumeToken, ClientConnection>();
  private nextSequence = 1;

  register(
    factory: (playerId: PlayerId, resumeToken: ResumeToken) => ClientConnection,
  ): ClientConnection {
    const playerId = `player-${this.nextSequence++}`;
    let resumeToken: ResumeToken;
    do {
      resumeToken = randomBytes(32).toString("base64url");
    } while (this.byResumeToken.has(resumeToken));
    const connection = factory(playerId, resumeToken);
    this.players.set(playerId, connection);
    this.byResumeToken.set(resumeToken, connection);
    return connection;
  }

  get(playerId: PlayerId): ClientConnection | undefined { return this.players.get(playerId); }
  getByResumeToken(resumeToken: ResumeToken): ClientConnection | undefined {
    return this.byResumeToken.get(resumeToken);
  }
  playerIds(): readonly PlayerId[] { return [...this.players.keys()]; }
  connections(): readonly ClientConnection[] { return [...this.players.values()]; }
  remove(playerId: PlayerId, expected?: ClientConnection): void {
    const current = this.players.get(playerId);
    if (expected !== undefined && current !== expected) return;
    if (current === undefined) return;
    this.players.delete(playerId);
    this.byResumeToken.delete(current.resumeToken);
  }
}
