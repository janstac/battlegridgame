import type { Server as HttpServer, IncomingMessage } from "node:http";
import {
  parseAdminConnectionServerMessage,
  parseAdminNetworkClientMessage,
  parseAdminNetworkServerMessage,
  parseAnonymousNetworkClientMessage,
  parseNetworkClientMessage,
  parseNetworkServerMessage,
  type AdminConnectionServerMessage,
  type AdminNetworkClientMessage,
  type AdminNetworkServerMessage,
  type NetworkServerMessage,
} from "@grid-game/shared";
import { WebSocket, WebSocketServer } from "ws";
import { ADMIN_TOKEN } from "../admin/AdminToken.ts";
import type { PlayerDirectory } from "../application/PlayerDirectory.ts";
import { ClientConnection, type ClientTransport } from "../application/ClientConnection.ts";
import type { WorldCoordinator } from "../application/WorldCoordinator.ts";

export type AdminMessageOutput = (message: AdminNetworkServerMessage) => void;
export type AdminMessageHandler = (
  message: AdminNetworkClientMessage,
  output: AdminMessageOutput,
) => Promise<void> | void;

export interface PlayerSessionClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type BattleWebSocketGatewayOptions = Readonly<{
  resumeGraceMs?: number;
  sessionClock?: PlayerSessionClock;
  reportError?: (error: unknown) => void;
}>;

export const DEFAULT_PLAYER_SESSION_RESUME_GRACE_MS = 30_000;
const SYSTEM_CLOCK: PlayerSessionClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as NodeJS.Timeout),
};

type SocketTransport = ClientTransport & Readonly<{ close(): void }>;
type SocketSession =
  | { role: "anonymous" }
  | { role: "player"; connection: ClientConnection; transport: SocketTransport }
  | { role: "admin"; operations: Promise<void> };

/** WebSocket transport adapter; logical player sessions outlive transient sockets. */
export class BattleWebSocketGateway {
  private readonly players: PlayerDirectory;
  private readonly coordinator: WorldCoordinator;
  private readonly handleAdminMessage: AdminMessageHandler;
  private readonly resumeGraceMs: number;
  private readonly sessionClock: PlayerSessionClock;
  private readonly reportError: (error: unknown) => void;
  private readonly webSockets = new Set<WebSocket>();
  private readonly sessions = new Map<WebSocket, SocketSession>();
  private readonly expiryTimers = new Map<ClientConnection, unknown>();
  private readonly server = new WebSocketServer({ noServer: true });

  constructor(
    httpServer: HttpServer,
    players: PlayerDirectory,
    coordinator: WorldCoordinator,
    handleAdminMessage: AdminMessageHandler = (message, output) => {
      output({ type: "adminError", requestId: message.requestId, code: "internal", message: "Admin service unavailable" });
    },
    options: BattleWebSocketGatewayOptions = {},
  ) {
    this.players = players;
    this.coordinator = coordinator;
    this.handleAdminMessage = handleAdminMessage;
    this.resumeGraceMs = options.resumeGraceMs ?? DEFAULT_PLAYER_SESSION_RESUME_GRACE_MS;
    this.sessionClock = options.sessionClock ?? SYSTEM_CLOCK;
    this.reportError = options.reportError ?? ((error) => console.error(error));
    httpServer.on("upgrade", (request, socket, head) => {
      if (!this.isEndpoint(request)) { socket.destroy(); return; }
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.server.emit("connection", webSocket, request);
      });
    });
    this.server.on("connection", (socket) => this.accept(socket));
  }

  async close(): Promise<void> {
    for (const timer of this.expiryTimers.values()) this.sessionClock.clearTimeout(timer);
    this.expiryTimers.clear();
    const connections = [...this.players.connections()];
    for (const socket of this.webSockets) socket.close(1001, "server shutdown");
    this.webSockets.clear();
    this.sessions.clear();
    await Promise.all(connections.map((connection) => connection.close()));
    this.server.close();
  }

  private accept(socket: WebSocket): void {
    this.webSockets.add(socket);
    this.sessions.set(socket, { role: "anonymous" });
    socket.on("message", (data, isBinary) => {
      if (isBinary) { socket.close(1008, "text messages required"); return; }
      try { this.receive(socket, JSON.parse(data.toString())); }
      catch { socket.close(1008, "invalid message"); }
    });
    socket.once("close", () => {
      this.webSockets.delete(socket);
      const session = this.sessions.get(socket);
      this.sessions.delete(socket);
      if (session?.role === "player" && session.connection.detachTransport(session.transport)) {
        this.scheduleExpiry(session.connection);
      }
    });
  }

  private receive(socket: WebSocket, value: unknown): void {
    const session = this.sessions.get(socket);
    if (session === undefined) return;
    switch (session.role) {
      case "anonymous": {
        const message = parseAnonymousNetworkClientMessage(value);
        if (message.type === "connectAsAdmin") {
          if (message.token !== ADMIN_TOKEN) { socket.close(1008, "authentication failed"); return; }
          this.sessions.set(socket, { role: "admin", operations: Promise.resolve() });
          this.sendAdminConnection(socket, { type: "connectedAsAdmin" });
          return;
        }
        const transport = this.createTransport(socket);
        if (message.type === "resumePlayer") {
          const connection = this.players.getByResumeToken(message.resumeToken);
          if (connection === undefined || connection.isClosed) {
            this.sendPlayer(socket, { type: "resumeRejected" });
            return;
          }
          this.cancelExpiry(connection);
          const previous = connection.attachTransport(transport) as SocketTransport | null;
          this.sessions.set(socket, { role: "player", connection, transport });
          previous?.close();
          void connection.resume().catch((error: unknown) => this.failSocket(socket, error));
          return;
        }
        const connection = this.players.register((playerId, resumeToken) => (
          new ClientConnection(playerId, resumeToken, this.coordinator, this.resumeGraceMs)
        ));
        connection.attachTransport(transport);
        this.sessions.set(socket, { role: "player", connection, transport });
        void connection.open().catch((error: unknown) => this.failSocket(socket, error));
        return;
      }
      case "player": {
        const message = parseNetworkClientMessage(value);
        void session.connection.receive(message).catch((error: unknown) => this.failSocket(socket, error));
        return;
      }
      case "admin": {
        const message = parseAdminNetworkClientMessage(value);
        const output: AdminMessageOutput = (outbound) => this.sendAdminMessage(socket, outbound);
        const next = session.operations.then(() => this.handleAdminMessage(message, output));
        session.operations = next.catch(() => undefined);
        void next.catch((error: unknown) => this.failSocket(socket, error));
        return;
      }
    }
  }

  private createTransport(socket: WebSocket): SocketTransport {
    return {
      output: (message) => this.sendPlayer(socket, message),
      protocolViolation: () => socket.close(1008, "protocol violation"),
      close: () => socket.close(4001, "session resumed elsewhere"),
    };
  }

  private failSocket(socket: WebSocket, error: unknown): void {
    this.reportError(error);
    socket.close(1011, "server error");
  }

  private scheduleExpiry(connection: ClientConnection): void {
    this.cancelExpiry(connection);
    const timer = this.sessionClock.setTimeout(() => {
      this.expiryTimers.delete(connection);
      if (!connection.isAttached && !connection.isClosed) void connection.close();
    }, this.resumeGraceMs);
    this.expiryTimers.set(connection, timer);
  }

  private cancelExpiry(connection: ClientConnection): void {
    const timer = this.expiryTimers.get(connection);
    if (timer === undefined) return;
    this.expiryTimers.delete(connection);
    this.sessionClock.clearTimeout(timer);
  }

  private sendPlayer(socket: WebSocket, message: NetworkServerMessage): void {
    this.write(socket, parseNetworkServerMessage(message));
  }
  private sendAdminConnection(socket: WebSocket, message: AdminConnectionServerMessage): void {
    this.write(socket, parseAdminConnectionServerMessage(message));
  }
  private sendAdminMessage(socket: WebSocket, message: AdminNetworkServerMessage): void {
    this.write(socket, parseAdminNetworkServerMessage(message));
  }
  private write(socket: WebSocket, message: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  private isEndpoint(request: IncomingMessage): boolean {
    try { return new URL(request.url ?? "", "http://localhost").pathname === "/ws"; }
    catch { return false; }
  }
}
