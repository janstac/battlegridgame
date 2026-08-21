import {
  parseNetworkServerMessage,
  type BattleId,
  type ClientMessage,
  type NetworkClientMessage,
  type NetworkServerMessage,
  type PlayerId,
  type RequestId,
  type ResumeToken,
} from "@grid-game/shared";
import { NetworkBattleSession } from "./NetworkBattleSession.ts";
import { NetworkWorldSession } from "./NetworkWorldSession.ts";
import { loadResumeToken, saveResumeToken } from "./ResumeTokenStore.ts";

export interface NetworkWebSocket {
  readonly readyState: number;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(
    type: "close",
    listener: (event: Readonly<{ code: number; reason: string; wasClean: boolean }>) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type NetworkClientEvent =
  | { type: "battleJoined"; session: NetworkBattleSession }
  | { type: "battleLeft"; battleId: BattleId }
  | { type: "connectionClosed"; reason: "client" | "socket" | "error"; error: Error | null };

export type NetworkClientOptions = Readonly<{
  webSocketFactory?: (url: string) => NetworkWebSocket;
  requestIdFactory?: () => RequestId;
  resumeToken?: ResumeToken;
}>;

const CLIENT_PROTOCOL_ERROR_CLOSE_CODE = 4000;

function closeSocket(socket: NetworkWebSocket, code?: number, reason?: string): void {
  try { socket.close(code, reason); }
  catch { try { socket.close(); } catch { /* The socket is already unusable. */ } }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function socketCloseError(event: Readonly<{ code: number; reason: string; wasClean: boolean }>): Error {
  const reason = event.reason.length === 0 ? "no reason provided" : event.reason;
  const cleanliness = event.wasClean ? "clean" : "unclean";
  return new Error(`WebSocket closed (${event.code}, ${cleanliness}): ${reason}`);
}

/** Owns one multiplexed socket and all remote battle sessions on it. */
export class NetworkClient {
  readonly playerId: PlayerId;
  readonly resumeToken: ResumeToken | undefined;
  readonly world: NetworkWorldSession;
  private readonly socket: NetworkWebSocket;
  private readonly requestIdFactory: () => RequestId;
  private readonly sessions = new Map<BattleId, NetworkBattleSession>();
  private readonly listeners = new Set<(event: NetworkClientEvent) => void>();
  private readonly leaveRequests = new Map<BattleId, () => void>();
  private closed = false;

  private constructor(
    socket: NetworkWebSocket,
    playerId: PlayerId,
    resumeToken: ResumeToken | undefined,
    requestIdFactory: () => RequestId,
  ) {
    this.socket = socket;
    this.playerId = playerId;
    this.resumeToken = resumeToken;
    this.requestIdFactory = requestIdFactory;
    this.world = new NetworkWorldSession(this);
  }

  static async connect(url: string, options: NetworkClientOptions = {}): Promise<NetworkClient> {
    const factory: (target: string) => NetworkWebSocket = options.webSocketFactory
      ?? ((target) => new WebSocket(target));
    const socket = factory(url);
    const resumeToken = options.resumeToken ?? loadResumeToken() ?? undefined;
    let sequence = 0;
    const requestIdFactory = options.requestIdFactory ?? (() => `${sequence++}`);
    return await new Promise<NetworkClient>((resolve, reject) => {
      let client: NetworkClient | null = null;
      let settled = false;
      let roleSent = false;
      let fallbackSent = false;
      const sendFreshRole = () => {
        socket.send(JSON.stringify({ type: "connectAsPlayer" }));
        fallbackSent = true;
      };
      const identifyAsPlayer = () => {
        if (roleSent) return;
        try {
          socket.send(JSON.stringify(resumeToken === undefined
            ? { type: "connectAsPlayer" }
            : { type: "resumePlayer", resumeToken }));
          roleSent = true;
        } catch (error) {
          if (!settled) reject(error);
          closeSocket(socket, CLIENT_PROTOCOL_ERROR_CLOSE_CODE, "player role handshake failed");
        }
      };
      socket.addEventListener("open", identifyAsPlayer);
      socket.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string") throw new TypeError("Expected a text WebSocket message");
          const message = parseNetworkServerMessage(JSON.parse(event.data));
          if (client === null) {
            if (message.type === "resumeRejected") {
              if (resumeToken === undefined || fallbackSent) throw new Error("Unexpected resume rejection");
              sendFreshRole();
              return;
            }
            if (message.type !== "connected") throw new Error("First server message must be connected");
            client = new NetworkClient(socket, message.playerId, message.resumeToken, requestIdFactory);
            if (message.resumeToken !== undefined) saveResumeToken(message.resumeToken);
            settled = true;
            resolve(client);
            return;
          }
          client.receive(message);
        } catch (error) {
          const failure = asError(error);
          try {
            if (client === null) { if (!settled) reject(failure); }
            else client.terminate("error", failure);
          } finally {
            closeSocket(socket, CLIENT_PROTOCOL_ERROR_CLOSE_CODE, "invalid server message");
          }
        }
      });
      socket.addEventListener("error", () => {
        const failure = new Error("WebSocket connection failed");
        try {
          if (!settled) reject(failure);
          client?.terminate("error", failure);
        } finally { closeSocket(socket); }
      });
      socket.addEventListener("close", (event) => {
        const failure = socketCloseError(event);
        if (!settled) reject(new Error(`WebSocket closed before connecting: ${failure.message}`));
        client?.terminate("socket", failure);
      });
      if (socket.readyState === 1) identifyAsPlayer();
    });
  }

  readonly subscribe = (listener: (event: NetworkClientEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSession(battleId: BattleId): NetworkBattleSession | undefined { return this.sessions.get(battleId); }
  getSessions(): readonly NetworkBattleSession[] { return [...this.sessions.values()]; }

  async sendBattleMessage(battleId: BattleId, message: ClientMessage): Promise<void> {
    this.assertOpen();
    if (!this.sessions.has(battleId)) throw new Error(`Not joined to battle: ${battleId}`);
    this.sendNetworkMessage({ type: "battleMessage", battleId, message });
  }

  async leaveBattle(battleId: BattleId): Promise<void> {
    this.assertOpen();
    if (!this.sessions.has(battleId)) return;
    const existing = this.leaveRequests.get(battleId);
    if (existing !== undefined) return await new Promise<void>((resolve) => {
      const prior = existing;
      this.leaveRequests.set(battleId, () => { prior(); resolve(); });
    });
    const result = new Promise<void>((resolve) => this.leaveRequests.set(battleId, resolve));
    try { this.sendNetworkMessage({ type: "leaveBattle", battleId }); }
    catch (error) { this.leaveRequests.delete(battleId); throw error; }
    await result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try { this.terminate("client", null); }
    finally { this.socket.close(1000, "client closed"); }
  }

  private receive(message: NetworkServerMessage): void {
    if (this.closed) return;
    switch (message.type) {
      case "connected":
        throw new Error("Received a duplicate connected message");
      case "resumeRejected":
        throw new Error("Received resume rejection after connection established");
      case "battleJoined": {
        const localRosterEntry = message.roster.find(({ participantId }) => participantId === message.localParticipantId);
        if (localRosterEntry?.playerId !== this.playerId || this.sessions.has(message.battleId)) {
          throw new Error("Received invalid battle membership");
        }
        const session = new NetworkBattleSession(
          this, message.battleId, message.localParticipantId, message.roster,
          message.worldPosition, message.snapshot,
        );
        this.sessions.set(message.battleId, session);
        this.publish({ type: "battleJoined", session });
        return;
      }
      case "battleLeft": {
        const session = this.sessions.get(message.battleId);
        if (session === undefined) return;
        this.sessions.delete(message.battleId);
        session.terminate();
        this.leaveRequests.get(message.battleId)?.();
        this.leaveRequests.delete(message.battleId);
        this.publish({ type: "battleLeft", battleId: message.battleId });
        return;
      }
      case "battleMessage":
        this.sessions.get(message.battleId)?.receive(message.message);
        return;
      case "worldSnapshot":
        this.world.receiveSnapshot(message.snapshot, message.challengeable);
        return;
      case "worldDelta":
        this.world.receiveDelta({ fromRevision: message.fromRevision, revision: message.revision, changes: message.changes }, message.challengeable);
        return;
      case "worldCommandAccepted":
        this.world.receiveCommandResult(message.requestId, null);
        return;
      case "worldCommandRejected":
        this.world.receiveCommandResult(message.requestId, message.reason);
        return;
    }
  }

  /** @internal Used by child sessions sharing this socket. */
  sendNetworkMessage(message: NetworkClientMessage): void {
    if (this.socket.readyState !== 1) throw new Error("WebSocket is not open");
    this.socket.send(JSON.stringify(message));
  }

  /** @internal Allocates correlation IDs across every session on the socket. */
  createRequestId(): RequestId {
    this.assertOpen();
    return this.requestIdFactory();
  }

  private publish(event: NetworkClientEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private terminate(reason: "client" | "socket" | "error", error: Error | null): void {
    if (this.closed) return;
    this.closed = true;
    const rejection = error ?? new Error("NetworkClient closed");
    for (const session of this.sessions.values()) session.terminate();
    this.world.terminate(rejection);
    this.sessions.clear();
    for (const resolve of this.leaveRequests.values()) resolve();
    this.leaveRequests.clear();
    try { this.publish({ type: "connectionClosed", reason, error }); }
    finally { this.listeners.clear(); }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("NetworkClient has been closed");
  }
}
