import { pathToFileURL } from "node:url";

import { NetworkClient } from "@grid-game/client/headless";

import type { BotFactory } from "./Bot.ts";
import { BotRuntime, type BotRuntimeResult } from "./BotRuntime.ts";
import { SmartBot } from "./SmartBot.ts";

export interface BotSignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
}

export type BotCliDependencies = Readonly<{
  connect?: typeof NetworkClient.connect;
  factory?: BotFactory;
  signals?: BotSignalSource;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
}>;

export function parseBotUrl(args: readonly string[]): string {
  if (args.length !== 1 || args[0] === undefined) {
    throw new TypeError("Usage: npm run start:bot -- <ws://server/ws>");
  }
  let url: URL;
  try {
    url = new URL(args[0]);
  } catch {
    throw new TypeError("Bot server URL must be a valid ws: or wss: URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError("Bot server URL must use ws: or wss:");
  }
  return url.href;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function exitCode(result: BotRuntimeResult): number {
  return result.reason === "client" ? 0 : 1;
}

/** Connects one passive World player and runs every battle it is placed into. */
export async function runBotCli(
  args: readonly string[],
  dependencies: BotCliDependencies = {},
): Promise<number> {
  const writeOutput = dependencies.writeOutput ?? ((line) => process.stdout.write(`${line}\n`));
  const writeError = dependencies.writeError ?? ((line) => process.stderr.write(`${line}\n`));
  let url: string;
  try {
    url = parseBotUrl(args);
  } catch (error) {
    writeError(errorMessage(error));
    return 2;
  }

  const connect = dependencies.connect ?? NetworkClient.connect;
  const factory = dependencies.factory ?? (() => new SmartBot());
  const signals = dependencies.signals ?? process;
  let client: NetworkClient | null = null;
  let runtime: BotRuntime | null = null;
  const stop = () => { if (runtime !== null) void runtime.stop(); };

  try {
    client = await connect(url);
    runtime = new BotRuntime(client, factory);
    signals.on("SIGINT", stop);
    signals.on("SIGTERM", stop);
    writeOutput(`Connected as ${client.playerId}`);

    const bootstrap = await Promise.race([
      client.world.ready.then(() => null),
      runtime.done,
    ]);
    if (bootstrap !== null) {
      if (bootstrap.error !== null) writeError(errorMessage(bootstrap.error));
      return exitCode(bootstrap);
    }
    const result = await runtime.done;
    if (result.error !== null) writeError(errorMessage(result.error));
    return exitCode(result);
  } catch (error) {
    writeError(errorMessage(error));
    if (runtime !== null) await runtime.stop();
    else if (client !== null) await client.close();
    return 1;
  } finally {
    signals.off("SIGINT", stop);
    signals.off("SIGTERM", stop);
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  process.exitCode = await runBotCli(process.argv.slice(2));
}
