import type { ResumeToken } from "@grid-game/shared";

const STORAGE_KEY = "gridgame.resumeToken";

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadResumeToken(): ResumeToken | null {
  try {
    return storage()?.getItem(STORAGE_KEY) as ResumeToken | null;
  } catch {
    return null;
  }
}

export function saveResumeToken(resumeToken: ResumeToken): void {
  try {
    storage()?.setItem(STORAGE_KEY, resumeToken);
  } catch {
    // Storage is optional; reconnects still work within the current client lifetime.
  }
}

export function clearResumeToken(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}
