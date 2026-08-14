import type { Server as HttpServer, IncomingMessage } from "node:http";
import {
  parseAdminNetworkClientMessage,
  parseAnonymousNetworkClientMessage,
  parseNetworkClientMessage,
  type AdminNetworkClientMessage,
  type AdminNetworkServerMessage,
  type NetworkServerMessage,
} from "@grid-game/shared";
import { WebSocket, WebSocketServer } from "ws";
import { ADMIN_TOKEN } from "../admin/AdminToken.ts";
import type { PlayerDirectory } from "../application/PlayerDirectory.ts";
import { ClientConnection } from "../application/ClientConnection.ts";
import type { WorldCoordinator } from "../application/WorldCoordinator.ts";

export type AdminMessageOutput = (message: AdminNetworkServerMessage) => void;

export type AdminMessageHandler = (
  message: AdminNetworkClientMessage,
  output: AdminMessageOutput,
) => Promise<void> | void;

type SocketSession =
  | { role: "anonymous" }
  | { role: "player"; connection: ClientConnection }
  | { role: "admin"; operations: Promise<void> };

/** The sole WebSocket transport adapter; all application state lives elsewhere. */
export class BattleWebSocketGateway {
  private readonly players: PlayerDirectory;
  private readonly coordinator: WorldCoordinator;
  private readonly handleAdminMessage: AdminMessageHandler;
  private readonly webSockets = new Set<WebSocket>();
  private readonly sessions = new Map<WebSocket, SocketSession>();
  private readonly server = new WebSocketServer({ noServer: true });

  constructor(
    httpServer: HttpServer,
    players: PlayerDirectory,
    coordinator: WorldCoordinator,
    handleAdminMessage: AdminMessageHandler = (message, output) => {
      output({
        type: "adminError",
        requestId: message.requestId,
        code: "internal",
        message: "Admin service unavailable",
      });
    },
  ) {
    this.players = players;
    this.coordinator = coordinator;
    this.handleAdminMessage = handleAdminMessage;
    httpServer.on("upgrade", (request, socket, head) => {
      if (!this.isEndpoint(request)) {
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.server.emit("connection", webSocket, request);
      });
    });
    this.server.on("connection", (socket) => this.accept(socket));
  }

  async close(): Promise<void> {
    const connections = [...this.sessions.values()].flatMap((session) => (
      session.role === "player" ? [session.connection] : []
    ));
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
      try {
        this.receive(socket, JSON.parse(data.toString()));
      } catch {
        socket.close(1008, "invalid message");
      }
    });
    socket.once("close", () => {
      this.webSockets.delete(socket);
      const session = this.sessions.get(socket);
      this.sessions.delete(socket);
      if (session?.role === "player") void session.connection.close();
    });
  }

  private receive(socket: WebSocket, value: unknown): void {
    const session = this.sessions.get(socket);
    if (session === undefined) return;

    switch (session.role) {
      case "anonymous": {
        const message = parseAnonymousNetworkClientMessage(value);
        if (message.type === "connectAsAdmin") {
          if (message.token !== ADMIN_TOKEN) {
            socket.close(1008, "authentication failed");
            return;
          }
          this.sessions.set(socket, { role: "admin", operations: Promise.resolve() });
          this.send(socket, { type: "connectedAsAdmin" });
          return;
        }

        const output = (outbound: NetworkServerMessage) => this.send(socket, outbound);
        const connection = this.players.register((playerId) => new ClientConnection(
          playerId,
          this.coordinator,
          output,
          () => socket.close(1008, "protocol violation"),
        ));
        this.sessions.set(socket, { role: "player", connection });
        // open() sends identity immediately. Its queued World bootstrap completes
        // before receive() handles any subsequently received message.
        void connection.open().catch(() => socket.close(1011, "server error"));
        return;
      }
      case "player": {
        const message = parseNetworkClientMessage(value);
        void session.connection.receive(message).catch(() => {
          socket.close(1011, "server error");
        });
        return;
      }
      case "admin": {
        const message = parseAdminNetworkClientMessage(value);
        const output: AdminMessageOutput = (outbound) => this.send(socket, outbound);
        const next = session.operations.then(() => this.handleAdminMessage(message, output));
        session.operations = next.catch(() => undefined);
        void next.catch(() => socket.close(1011, "server error"));
        return;
      }
    }
  }

  private send(socket: WebSocket, message: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private isEndpoint(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "", "http://localhost").pathname === "/ws";
    } catch {
      return false;
    }
  }
}
