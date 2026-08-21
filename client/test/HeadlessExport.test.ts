import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type {
  NetworkClient as HeadlessNetworkClient,
  NetworkWebSocket,
} from "@grid-game/client/headless";
import type {
  AnonymousNetworkClientMessage,
  NetworkClientMessage,
  NetworkServerMessage,
} from "@grid-game/shared";

class FakeSocket implements NetworkWebSocket {
  readyState = 0;
  readonly sent: Array<AnonymousNetworkClientMessage | NetworkClientMessage> = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: ((event: MessageEvent<unknown>) => void)
      | ((event: Readonly<{ code: number; reason: string; wasClean: boolean }>) => void)
      | (() => void),
  ): void {
    if (type === "open") this.openListeners.push(listener as () => void);
    if (type === "message") {
      this.messageListeners.push(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as AnonymousNetworkClientMessage | NetworkClientMessage);
  }

  close(): void {
    this.readyState = 3;
  }

  emitOpen(): void {
    this.readyState = 1;
    for (const listener of this.openListeners) listener();
  }

  emit(message: NetworkServerMessage): void {
    for (const listener of this.messageListeners) {
      listener({ data: JSON.stringify(message) } as MessageEvent<string>);
    }
  }
}

test("the headless package export loads and connects without browser UI dependencies", async () => {
  const forbiddenPackages = new Set(["react", "react-dom", "vite"]);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        [...forbiddenPackages].some(
          (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
        )
        || specifier.endsWith(".tsx")
        || specifier.endsWith(".css")
        || specifier.endsWith("/networkUrl.ts")
      ) {
        throw new Error(`Headless import loaded a UI dependency: ${specifier}`);
      }
      return nextResolve(specifier, context);
    },
  });
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const failBrowserAccess = (): never => {
    throw new Error("Headless import accessed a browser UI global");
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get: failBrowserAccess,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    get: failBrowserAccess,
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    get: failBrowserAccess,
  });

  try {
    const headless = await import("@grid-game/client/headless");

    assert.equal(typeof headless.NetworkClient, "function");
    assert.equal(typeof headless.NetworkBattleSession, "function");
    assert.equal(typeof headless.NetworkWorldSession, "function");
    assert.equal(typeof headless.ClientBattleState, "function");
    assert.equal(typeof headless.ClientWorldState, "function");

    const socket = new FakeSocket();
    const connecting: Promise<HeadlessNetworkClient> = headless.NetworkClient.connect(
      "ws://example.test/ws",
      { webSocketFactory: () => socket },
    );
    socket.emitOpen();
    assert.deepEqual(socket.sent, [{ type: "connectAsPlayer" }]);
    socket.emit({ type: "connected", playerId: "headless-player" });

    const client = await connecting;
    assert.equal(client.playerId, "headless-player");
    await client.close();
  } finally {
    hooks.deregister();
    if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", priorWindow);
    if (priorDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", priorDocument);
    if (priorWebSocket === undefined) delete (globalThis as { WebSocket?: unknown }).WebSocket;
    else Object.defineProperty(globalThis, "WebSocket", priorWebSocket);
  }
});
