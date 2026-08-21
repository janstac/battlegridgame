import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  clearResumeSession,
  hasFreshResumeSession,
  loadFreshResumeSession,
  markResumeSessionDisconnected,
  saveConnectedResumeSession,
} from "../src/session/ResumeTokenStore.ts";
import { initialAppMode } from "../src/app/initialAppMode.ts";

const KEY = "gridgame.resumeSession";
const TOKEN = "a".repeat(32);

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

let memory: MemoryStorage;
let priorDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  memory = new MemoryStorage();
  priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: memory });
});

afterEach(() => {
  if (priorDescriptor === undefined) delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  else Object.defineProperty(globalThis, "sessionStorage", priorDescriptor);
});

function save(grace = 100, connectionId = "connection-1", token = TOKEN) {
  saveConnectedResumeSession({ resumeToken: token, resumeGraceMs: grace, connectionId });
}

test("stores connected state and makes it fresh only after a recent disconnect", () => {
  save();
  assert.deepEqual(JSON.parse(memory.getItem(KEY) ?? ""), {
    version: 1, resumeToken: TOKEN, resumeGraceMs: 100,
    disconnectedAt: null, connectionId: "connection-1",
  });
  assert.equal(hasFreshResumeSession(1_000), false);
  markResumeSessionDisconnected("connection-1", 1_000);
  assert.deepEqual(initialAppMode(1_099), { kind: "network", resumeOnly: true });
  assert.equal(loadFreshResumeSession(1_099)?.resumeToken, TOKEN);
  assert.equal(loadFreshResumeSession(1_100), null);
  assert.equal(initialAppMode(1_100), null);
  assert.equal(memory.getItem(KEY), null);
});

test("initial app mode stays at the chooser without stored metadata", () => {
  assert.equal(initialAppMode(1_000), null);
});

test("expired, zero-grace, future, malformed, and legacy records are not fresh", () => {
  save(0);
  markResumeSessionDisconnected("connection-1", 10);
  assert.equal(loadFreshResumeSession(10), null);
  save();
  markResumeSessionDisconnected("connection-1", 20);
  assert.equal(loadFreshResumeSession(19), null);
  memory.setItem(KEY, "not json");
  assert.equal(loadFreshResumeSession(), null);
  assert.equal(memory.getItem(KEY), null);
  memory.setItem("gridgame.resumeToken", TOKEN);
  assert.equal(hasFreshResumeSession(), false);
});

test("connection and token guards preserve newer session state", () => {
  save(100, "new", "b".repeat(32));
  markResumeSessionDisconnected("old", 10);
  assert.equal(JSON.parse(memory.getItem(KEY) ?? "").disconnectedAt, null);
  clearResumeSession(TOKEN);
  assert.ok(memory.getItem(KEY));
  clearResumeSession("b".repeat(32));
  assert.equal(memory.getItem(KEY), null);
});

test("unavailable storage fails safely", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() { throw new Error("blocked"); },
  });
  assert.doesNotThrow(() => save());
  assert.equal(loadFreshResumeSession(), null);
  assert.doesNotThrow(() => markResumeSessionDisconnected("connection-1"));
  assert.doesNotThrow(() => clearResumeSession());
});
