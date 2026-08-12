import assert from "node:assert/strict";
import test from "node:test";
import { resolveNetworkUrl } from "../src/network/networkUrl.ts";

test("uses a configured network URL after trimming whitespace", () => {
  assert.equal(
    resolveNetworkUrl("  wss://game.example/socket  ", {
      protocol: "https:",
      host: "ignored.example",
    }),
    "wss://game.example/socket",
  );
});

test("derives same-origin ws and wss endpoints", () => {
  assert.equal(
    resolveNetworkUrl(undefined, { protocol: "http:", host: "localhost:5173" }),
    "ws://localhost:5173/ws",
  );
  assert.equal(
    resolveNetworkUrl("", { protocol: "https:", host: "game.example" }),
    "wss://game.example/ws",
  );
});
