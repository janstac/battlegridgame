import type { Server as HttpServer, IncomingMessage } from "node:http";
import { parseNetworkClientMessage, type NetworkServerMessage } from "@grid-game/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { PlayerDirectory } from "../application/PlayerDirectory.ts";
import { ClientConnection } from "../application/ClientConnection.ts";
import type { WorldCoordinator } from "../application/WorldCoordinator.ts";

/** The sole WebSocket transport adapter; all application state lives elsewhere. */
export class BattleWebSocketGateway {
  private readonly players: PlayerDirectory;
  private readonly coordinator: WorldCoordinator;
  private readonly webSockets = new Set<WebSocket>();
  private readonly connections = new Map<WebSocket, ClientConnection>();
  private readonly server = new WebSocketServer({ noServer: true });

  constructor(
    httpServer: HttpServer,
    players: PlayerDirectory,
    coordinator: WorldCoordinator,
  ) {
    this.players = players;
    this.coordinator = coordinator;
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
    const connections = [...this.connections.values()];
    for (const socket of this.webSockets) socket.close(1001, "server shutdown");
    this.webSockets.clear();
    this.connections.clear();
    await Promise.all(connections.map((connection) => connection.close()));
    this.server.close();
  }

  private accept(socket: WebSocket): void {
    this.webSockets.add(socket);
    const output = (message: NetworkServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const connection = this.players.register((playerId) => new ClientConnection(
      playerId,
      this.coordinator,
      output,
      () => socket.close(1008, "protocol violation"),
    ));
    this.connections.set(socket, connection);
    // open() sends identity immediately. Its queued World bootstrap completes
    // before receive() handles any subsequently received message.
    void connection.open().catch(() => socket.close(1011, "server error"));
    socket.on("message", (data, isBinary) => {
      if (isBinary) { socket.close(1008, "text messages required"); return; }
      try {
        const message = parseNetworkClientMessage(JSON.parse(data.toString()));
        void connection.receive(message).catch(() => socket.close(1011, "server error"));
      } catch {
        socket.close(1008, "invalid message");
      }
    });
    socket.once("close", () => {
      this.webSockets.delete(socket);
      this.connections.delete(socket);
      void connection.close();
    });
  }

  private isEndpoint(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "", "http://localhost").pathname === "/ws";
    } catch {
      return false;
    }
  }
}
