import process from "node:process";
import { createInterface, type Interface } from "node:readline";
import {
  parseAdminConnectionServerMessage,
  parseAdminNetworkClientMessage,
  parseAdminNetworkServerMessage,
  type AdminNetworkServerMessage,
} from "@grid-game/shared";
import { WebSocket, type RawData } from "ws";

import { ADMIN_TOKEN } from "./AdminToken.ts";

const MAX_OUTSTANDING_REQUESTS = 64;
const USAGE = "Usage: npm run admin -- <ws://host:port/ws>";

type Deferred = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseUrl(argument: string | undefined): string | null {
  if (argument === undefined) return null;
  try {
    const url = new URL(argument);
    return url.protocol === "ws:" || url.protocol === "wss:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

class AdminCli {
  private readonly socket: WebSocket;
  private readonly authenticated = deferred();
  private readonly completed = deferred();
  private readonly outstandingRequestIds = new Set<string>();
  private input: Interface | null = null;
  private isAuthenticated = false;
  private inputEnded = false;
  private closing = false;
  private failed = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("open", () => {
      this.socket.send(JSON.stringify({
        type: "connectAsAdmin",
        token: ADMIN_TOKEN,
      }), (error) => {
        if (error != null) {
          this.fail(`Could not send admin handshake: ${error.message}`);
        }
      });
    });
    this.socket.on("message", (data, isBinary) => {
      this.receive(data, isBinary);
    });
    this.socket.on("error", (error) => {
      this.fail(`WebSocket error: ${error.message}`);
    });
    this.socket.on("close", (code, reason) => {
      this.handleClose(code, reason.toString());
    });
  }

  async run(): Promise<void> {
    await this.authenticated.promise;
    if (this.failed) return;

    this.input = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });

    let lineNumber = 0;
    for await (const line of this.input) {
      lineNumber += 1;
      if (line.trim() === "") continue;
      await this.sendInputLine(line, lineNumber);
      if (this.failed) break;
    }

    this.inputEnded = true;
    this.closeIfDrained();
    await this.completed.promise;
  }

  private receive(data: RawData, isBinary: boolean): void {
    if (this.failed) return;
    if (isBinary) {
      this.fail("Server sent a binary WebSocket frame");
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(data.toString()) as unknown;
    } catch (error) {
      this.fail(`Server sent malformed JSON: ${errorMessage(error)}`);
      return;
    }

    if (!this.isAuthenticated) {
      try {
        const message = parseAdminConnectionServerMessage(value);
        if (message.type !== "connectedAsAdmin") {
          throw new TypeError("Expected connectedAsAdmin as the first server message");
        }
      } catch (error) {
        this.fail(`Admin authentication failed: ${errorMessage(error)}`);
        return;
      }
      this.isAuthenticated = true;
      process.stderr.write("Authenticated as admin\n");
      this.authenticated.resolve();
      return;
    }

    let message: AdminNetworkServerMessage;
    try {
      message = parseAdminNetworkServerMessage(value);
    } catch (error) {
      this.fail(`Server sent an invalid admin message: ${errorMessage(error)}`);
      return;
    }

    if (!this.outstandingRequestIds.delete(message.requestId)) {
      this.fail(`Server responded with unknown requestId ${JSON.stringify(message.requestId)}`);
      return;
    }

    process.stdout.write(`${JSON.stringify(message)}\n`);
    this.closeIfDrained();
  }

  private async sendInputLine(line: string, lineNumber: number): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      this.rejectInput(lineNumber, `malformed JSON: ${errorMessage(error)}`);
      return;
    }

    let message;
    try {
      message = parseAdminNetworkClientMessage(value);
    } catch (error) {
      this.rejectInput(lineNumber, `invalid admin request: ${errorMessage(error)}`);
      return;
    }

    if (this.outstandingRequestIds.has(message.requestId)) {
      this.rejectInput(
        lineNumber,
        `requestId ${JSON.stringify(message.requestId)} is already outstanding`,
      );
      return;
    }
    if (this.outstandingRequestIds.size >= MAX_OUTSTANDING_REQUESTS) {
      this.rejectInput(
        lineNumber,
        `at most ${MAX_OUTSTANDING_REQUESTS} requests may be outstanding`,
      );
      return;
    }

    this.outstandingRequestIds.add(message.requestId);
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.send(JSON.stringify(message), (error) => {
          if (error == null) resolve();
          else reject(error);
        });
      });
    } catch (error) {
      this.outstandingRequestIds.delete(message.requestId);
      this.fail(`Could not send request ${JSON.stringify(message.requestId)}: ${errorMessage(error)}`);
    }
  }

  private rejectInput(lineNumber: number, message: string): void {
    this.fail(`Input line ${lineNumber}: ${message}`);
  }

  shutdown(signal: "SIGINT" | "SIGTERM"): void {
    if (this.failed || this.closing) return;

    process.exitCode = signal === "SIGINT" ? 130 : 143;
    process.stderr.write(`Received ${signal}; stopping input\n`);
    this.inputEnded = true;
    this.input?.close();

    if (this.isAuthenticated) {
      this.closeIfDrained();
      return;
    }

    this.closing = true;
    this.authenticated.reject(new Error(`Interrupted by ${signal}`));
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "interrupted");
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
    } else {
      this.completed.resolve();
    }
  }

  private closeIfDrained(): void {
    if (
      !this.inputEnded
      || this.outstandingRequestIds.size !== 0
      || this.closing
      || this.socket.readyState !== WebSocket.OPEN
    ) return;

    this.closing = true;
    this.socket.close(1000, "stdin ended");
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    process.exitCode = 1;
    process.stderr.write(`${message}\n`);
    this.input?.close();
    this.authenticated.reject(new Error(message));

    if (this.socket.readyState === WebSocket.OPEN) {
      this.closing = true;
      this.socket.close(1002, "protocol error");
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
    } else {
      this.completed.resolve();
    }
  }

  private handleClose(code: number, reason: string): void {
    this.input?.close();
    if (!this.isAuthenticated && !this.failed && !this.closing) {
      const suffix = reason === "" ? "" : `: ${reason}`;
      const message = `WebSocket closed before authentication (${code})${suffix}`;
      this.failed = true;
      process.exitCode = 1;
      process.stderr.write(`${message}\n`);
      this.authenticated.reject(new Error(message));
    } else if (!this.closing && !this.failed) {
      const suffix = reason === "" ? "" : `: ${reason}`;
      process.exitCode = 1;
      process.stderr.write(`WebSocket closed unexpectedly (${code})${suffix}\n`);
    }

    if (this.outstandingRequestIds.size !== 0 && !this.failed) {
      process.exitCode = 1;
      process.stderr.write(
        `WebSocket closed with ${this.outstandingRequestIds.size} outstanding request(s)\n`,
      );
    }
    this.completed.resolve();
  }
}

async function main(): Promise<void> {
  const url = process.argv.length === 3 ? parseUrl(process.argv[2]) : null;
  if (url === null) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 64;
    return;
  }

  const cli = new AdminCli(url);
  const stopForInterrupt = () => cli.shutdown("SIGINT");
  const stopForTermination = () => cli.shutdown("SIGTERM");
  process.once("SIGINT", stopForInterrupt);
  process.once("SIGTERM", stopForTermination);
  try {
    await cli.run();
  } catch {
    // The connection event handlers already emitted a specific diagnostic.
  } finally {
    process.off("SIGINT", stopForInterrupt);
    process.off("SIGTERM", stopForTermination);
  }
}

await main();
