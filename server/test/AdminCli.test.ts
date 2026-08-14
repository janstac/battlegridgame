import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { ADMIN_TOKEN } from "../src/admin/AdminToken.ts";
import { createGridGameServer } from "../src/server.ts";

const CLI_PATH = fileURLToPath(new URL("../src/admin/cli.ts", import.meta.url));
const ASYNC_TIMEOUT_MS = 2_000;

type ChildResult = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

function withTimeout<T>(promise: Promise<T>, description: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}`)),
      ASYNC_TIMEOUT_MS,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function spawnCli(url?: string): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<ChildResult>;
} {
  const child = spawn(process.execPath, url === undefined ? [CLI_PATH] : [CLI_PATH, url], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const result = withTimeout(new Promise<ChildResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  }), "admin CLI to exit");
  return { child, result };
}

async function startAdminEndpoint(
  t: TestContext,
  receive: (socket: WebSocket, value: unknown) => void,
): Promise<string> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  }), "mock admin endpoint to listen");
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  server.on("connection", (socket) => {
    socket.once("message", (data, isBinary) => {
      assert.equal(isBinary, false);
      assert.deepEqual(JSON.parse(data.toString()), {
        type: "connectAsAdmin",
        token: ADMIN_TOKEN,
      });
      socket.send(JSON.stringify({ type: "connectedAsAdmin" }));
      socket.on("message", (requestData, requestIsBinary) => {
        assert.equal(requestIsBinary, false);
        receive(socket, JSON.parse(requestData.toString()) as unknown);
      });
    });
  });

  const address = server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}/ws`;
}

test("admin CLI authenticates first and correlates out-of-order JSONL responses", async (t) => {
  const requests: Array<{ type: string; requestId: string }> = [];
  const url = await startAdminEndpoint(t, (socket, value) => {
    requests.push(value as { type: string; requestId: string });
    if (requests.length !== 2) return;
    socket.send(JSON.stringify({
      type: "adminBattles",
      requestId: requests[1]!.requestId,
      battles: [],
    }));
    socket.send(JSON.stringify({
      type: "adminPlayers",
      requestId: requests[0]!.requestId,
      playerIds: [],
    }));
  });
  const invocation = spawnCli(url);
  invocation.child.stdin.end([
    JSON.stringify({ type: "adminListPlayers", requestId: "players-1" }),
    JSON.stringify({ type: "adminListBattles", requestId: "battles-1" }),
    "",
  ].join("\n"));

  const result = await invocation.result;
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "Authenticated as admin\n");
  assert.deepEqual(result.stdout.trim().split("\n").map((line) => JSON.parse(line)), [
    { type: "adminBattles", requestId: "battles-1", battles: [] },
    { type: "adminPlayers", requestId: "players-1", playerIds: [] },
  ]);
  assert.deepEqual(requests.map(({ type, requestId }) => ({ type, requestId })), [
    { type: "adminListPlayers", requestId: "players-1" },
    { type: "adminListBattles", requestId: "battles-1" },
  ]);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(ADMIN_TOKEN));
});

test("admin CLI treats malformed input as fatal without sending it", async (t) => {
  const requests: unknown[] = [];
  const url = await startAdminEndpoint(t, (_socket, value) => {
    requests.push(value);
  });
  const invocation = spawnCli(url);
  invocation.child.stdin.end("{\n");

  const result = await invocation.result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Authenticated as admin/);
  assert.match(result.stderr, /Input line 1: malformed JSON/);
  assert.deepEqual(requests, []);
  assert.equal(result.stdout, "");
});

test("admin CLI uses semantic validation for duplicate world positions", async (t) => {
  const requests: unknown[] = [];
  const url = await startAdminEndpoint(t, (_socket, value) => {
    requests.push(value);
  });
  const invocation = spawnCli(url);
  const duplicatePositionRequest = {
    type: "adminReplaceWorldCells",
    requestId: "invalid-duplicate",
    changes: [0, 1].map(() => ({
      position: { x: 1, y: 2 },
      expected: { kind: "unoccupied" },
      next: { kind: "unoccupied" },
    })),
  };
  invocation.child.stdin.end(`${JSON.stringify(duplicatePositionRequest)}\n`);

  const result = await invocation.result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Input line 1: invalid admin request/);
  assert.deepEqual(requests, []);
  assert.equal(result.stdout, "");
});

test("admin CLI rejects a duplicate outstanding requestId", async (t) => {
  let requestCount = 0;
  const url = await startAdminEndpoint(t, (socket, value) => {
    requestCount += 1;
    const request = value as { requestId: string };
    setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        type: "adminPlayers",
        requestId: request.requestId,
        playerIds: [],
      }));
    }, 20);
  });
  const invocation = spawnCli(url);
  invocation.child.stdin.end([
    JSON.stringify({ type: "adminListPlayers", requestId: "same" }),
    JSON.stringify({ type: "adminListPlayers", requestId: "same" }),
    "",
  ].join("\n"));

  const result = await invocation.result;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requestId "same" is already outstanding/);
  assert.equal(requestCount, 1);
  assert.equal(result.stdout, "");
});

test("admin CLI treats invalid server messages as fatal protocol errors", async (t) => {
  const url = await startAdminEndpoint(t, (socket, value) => {
    const request = value as { requestId: string };
    socket.send(JSON.stringify({
      type: "adminPlayers",
      requestId: request.requestId,
    }));
  });
  const invocation = spawnCli(url);
  invocation.child.stdin.end(`${JSON.stringify({
    type: "adminListPlayers",
    requestId: "invalid-response",
  })}\n`);

  const result = await invocation.result;
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Server sent an invalid admin message/);
});

test("admin CLI interoperates with the real gateway and default admin service", async (t) => {
  const app = createGridGameServer();
  await withTimeout(new Promise<void>((resolve, reject) => {
    app.httpServer.once("error", reject);
    app.httpServer.listen(0, "127.0.0.1", () => {
      app.httpServer.off("error", reject);
      resolve();
    });
  }), "real gateway to listen");
  t.after(async () => app.close());
  const address = app.httpServer.address() as AddressInfo;
  const invocation = spawnCli(`ws://127.0.0.1:${address.port}/ws`);
  invocation.child.stdin.end(`${JSON.stringify({
    type: "adminListPlayers",
    requestId: "gateway-request",
  })}\n`);

  const result = await invocation.result;
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "Authenticated as admin\n");
  assert.deepEqual(JSON.parse(result.stdout), {
    type: "adminPlayers",
    requestId: "gateway-request",
    playerIds: [],
  });
});

test("admin CLI can terminate while authentication is pending", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await withTimeout(new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  }), "silent admin endpoint to listen");
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const handshake = new Promise<void>((resolve) => {
    server.once("connection", (socket) => {
      socket.once("message", (data) => {
        assert.deepEqual(JSON.parse(data.toString()), {
          type: "connectAsAdmin",
          token: ADMIN_TOKEN,
        });
        resolve();
      });
    });
  });
  const address = server.address() as AddressInfo;
  const invocation = spawnCli(`ws://127.0.0.1:${address.port}/ws`);
  await withTimeout(handshake, "admin handshake");
  invocation.child.kill("SIGTERM");

  const result = await invocation.result;
  assert.equal(result.code, 143);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Received SIGTERM; stopping input/);
  assert.doesNotMatch(result.stderr, new RegExp(ADMIN_TOKEN));
});

test("admin CLI prints usage for a missing or non-WebSocket URL", async () => {
  const missing = await spawnCli().result;
  assert.equal(missing.code, 64);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /^Usage:/);

  const invalid = await spawnCli("https://example.test/ws").result;
  assert.equal(invalid.code, 64);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /^Usage:/);
});
