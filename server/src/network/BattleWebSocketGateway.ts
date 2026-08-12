import type { Server as HttpServer, IncomingMessage } from "node:http";
import { parseNetworkClientMessage, type NetworkServerMessage } from "@grid-game/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { PlayerDirectory } from "../application/PlayerDirectory.ts";
import { ClientConnection } from "../application/ClientConnection.ts";
import type { BattleCoordinator } from "../application/BattleCoordinator.ts";

/** The sole WebSocket transport adapter; all application state lives elsewhere. */
export class BattleWebSocketGateway {
  private readonly players: PlayerDirectory;
  private readonly coordinator: BattleCoordinator;
  private readonly webSockets = new Set<WebSocket>();
  private readonly server = new WebSocketServer({ noServer: true });

  constructor(
    httpServer: HttpServer,
    players: PlayerDirectory,
    coordinator: BattleCoordinator,
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

  close(): void {
    for (const socket of this.webSockets) socket.close(1001, "server shutdown");
    this.webSockets.clear();
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
    // Install identity and send it before accepting any client messages.
    connection.sendConnected();
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
      this.players.remove(connection.playerId);
      connection.close();
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
