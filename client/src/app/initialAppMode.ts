import { hasFreshResumeSession } from "../session/ResumeTokenStore.ts";

export type AppMode =
  | { kind: "local" }
  | { kind: "network"; resumeOnly: boolean }
  | null;

export function initialAppMode(now = Date.now()): AppMode {
  return hasFreshResumeSession(now) ? { kind: "network", resumeOnly: true } : null;
}
