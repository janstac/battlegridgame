import {
  applyWorldDelta,
  type WorldDelta,
  type WorldSnapshot,
} from "@grid-game/shared";

/** Stable immutable projection consumed by React via useSyncExternalStore. */
export type ClientWorldViewState = Readonly<{
  snapshot: WorldSnapshot | null;
  challengeable: boolean;
  ready: boolean;
  resyncing: boolean;
}>;

function copySnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return structuredClone(snapshot);
}

/** Observable projection of the public, authoritative World grid. */
export class ClientWorldState {
  private snapshot: WorldSnapshot | null = null;
  private awaitingSnapshot = false;
  private challengeable = false;
  private viewState: ClientWorldViewState = {
    snapshot: null,
    challengeable: false,
    ready: false,
    resyncing: false,
  };
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): ClientWorldViewState => this.viewState;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replaces all projected state and completes any outstanding resync. */
  replaceSnapshot(snapshot: WorldSnapshot, challengeable: boolean): void {
    this.snapshot = copySnapshot(snapshot);
    this.challengeable = challengeable;
    this.awaitingSnapshot = false;
    this.publish();
  }

  /**
   * Applies a contiguous delta. Returns false when a fresh snapshot is needed.
   * Further deltas are ignored until that snapshot arrives.
   */
  applyDelta(delta: WorldDelta, challengeable: boolean): boolean {
    if (this.awaitingSnapshot) return false;
    if (this.snapshot === null) {
      this.awaitingSnapshot = true;
      this.publish();
      return false;
    }
    const result = applyWorldDelta(this.snapshot, delta);
    if (result.kind === "revisionGap") {
      this.awaitingSnapshot = true;
      this.publish();
      return false;
    }
    this.snapshot = result.snapshot;
    this.challengeable = challengeable;
    this.publish();
    return true;
  }

  private publish(): void {
    this.viewState = {
      snapshot: this.snapshot === null ? null : copySnapshot(this.snapshot),
      challengeable: this.challengeable,
      ready: this.snapshot !== null,
      resyncing: this.awaitingSnapshot,
    };
    for (const listener of [...this.listeners]) listener();
  }
}
