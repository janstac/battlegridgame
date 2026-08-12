import { pathToFileURL } from "node:url";
import { createGridGameServer } from "./server.ts";

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("PORT must be an integer from 0 through 65535");
  }
  const app = createGridGameServer({ debugEnabled: process.env.NODE_ENV !== "production" });
  await new Promise<void>((resolve, reject) => {
    app.httpServer.once("error", reject);
    app.httpServer.listen(port, resolve);
  });
  const shutdown = () => { void app.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
