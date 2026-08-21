import type { ResumeToken } from "@grid-game/shared";

const STORAGE_KEY = "gridgame.resumeSession";
const LEGACY_STORAGE_KEY = "gridgame.resumeToken";

export type StoredResumeSession = Readonly<{
  version: 1;
  resumeToken: ResumeToken;
  resumeGraceMs: number;
  disconnectedAt: number | null;
  connectionId: string;
}>;

type ConnectedResumeSession = Pick<StoredResumeSession, "resumeToken" | "resumeGraceMs" | "connectionId">;

function storage(): Storage | null {
  try { return globalThis.sessionStorage ?? null; }
  catch { return null; }
}

function remove(key = STORAGE_KEY): void {
  try { storage()?.removeItem(key); } catch { /* Storage is optional. */ }
}

function parseStored(value: string | null): StoredResumeSession | null {
  if (value === null) return null;
  try {
    const record: unknown = JSON.parse(value);
    if (typeof record !== "object" || record === null) return null;
    const candidate = record as Record<string, unknown>;
    if (candidate.version !== 1
      || typeof candidate.resumeToken !== "string"
      || typeof candidate.resumeGraceMs !== "number"
      || !Number.isSafeInteger(candidate.resumeGraceMs)
      || candidate.resumeGraceMs < 0
      || (candidate.disconnectedAt !== null && typeof candidate.disconnectedAt !== "number")
      || typeof candidate.connectionId !== "string") return null;
    return candidate as StoredResumeSession;
  } catch { return null; }
}

function loadStored(): StoredResumeSession | null {
  try {
    const store = storage();
    const value = store?.getItem(STORAGE_KEY) ?? null;
    const parsed = parseStored(value);
    if (value !== null && parsed === null) remove();
    return parsed;
  } catch { return null; }
}

export function saveConnectedResumeSession(session: ConnectedResumeSession): void {
  const record: StoredResumeSession = { version: 1, ...session, disconnectedAt: null };
  try {
    const store = storage();
    store?.setItem(STORAGE_KEY, JSON.stringify(record));
    store?.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* Storage is optional. */ }
}

export function markResumeSessionDisconnected(connectionId: string, now = Date.now()): void {
  const record = loadStored();
  if (record === null || record.connectionId !== connectionId || record.disconnectedAt !== null) return;
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...record, disconnectedAt: now })); }
  catch { /* Storage is optional. */ }
}

export function loadFreshResumeSession(now = Date.now()): StoredResumeSession | null {
  const record = loadStored();
  if (record === null) return null;
  const elapsed = record.disconnectedAt === null ? -1 : now - record.disconnectedAt;
  if (record.disconnectedAt !== null && record.resumeGraceMs > 0
    && elapsed >= 0 && elapsed < record.resumeGraceMs) return record;
  if (record.disconnectedAt !== null) remove();
  return null;
}

export function hasFreshResumeSession(now = Date.now()): boolean {
  return loadFreshResumeSession(now) !== null;
}

export function clearResumeSession(expectedResumeToken?: ResumeToken): void {
  if (expectedResumeToken !== undefined) {
    const record = loadStored();
    if (record === null || record.resumeToken !== expectedResumeToken) return;
  }
  remove();
}
