import type {
  ChallengeId,
  Position,
  RequestId,
  WorldCommandRejectionReason,
  WorldDelta,
  WorldSnapshot,
} from "@grid-game/shared";

import { ClientWorldState } from "../model/ClientWorldState.ts";
import type { NetworkClient } from "./NetworkClient.ts";

type PendingWorldCommand = Readonly<{
  resolve(): void;
  reject(error: Error): void;
}>;

function worldCommandRejectionMessage(reason: WorldCommandRejectionReason): string {
  switch (reason) {
    case "battleLimitReached":
      return "You already have the maximum number of concurrent battles. Leave or finish a battle, then try again.";
    case "invalidTarget":
    case "selfChallenge":
    case "unknownChallenge":
    case "challengeClosed":
    case "alreadyJoined":
    case "challengeFull":
    case "notParticipant":
      return reason;
  }
}

export class WorldCommandRejectedError extends Error {
  readonly reason: WorldCommandRejectionReason;

  constructor(reason: WorldCommandRejectionReason) {
    super(worldCommandRejectionMessage(reason));
    this.name = "WorldCommandRejectedError";
    this.reason = reason;
  }
}

/** Public World stream and correlated World commands for one socket. */
export class NetworkWorldSession {
  readonly state = new ClientWorldState();
  readonly ready: Promise<ClientWorldState>;
  private readonly client: NetworkClient;
  private readonly pending = new Map<RequestId, PendingWorldCommand>();
  private resolveReady!: (state: ClientWorldState) => void;
  private rejectReady!: (error: Error) => void;
  private readyResolved = false;
  private resyncRequested = false;
  private closed = false;

  constructor(client: NetworkClient) {
    this.client = client;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // The World is optional to low-level consumers such as debug/session tests.
    // Mark early termination as observed while preserving rejection for callers
    // that explicitly await `ready`.
    void this.ready.catch(() => undefined);
  }

  async challengeCell(position: Position): Promise<void> {
    return await this.command((requestId) => ({
      type: "challengeWorldCell",
      requestId,
      position: { ...position },
    }));
  }

  async joinChallenge(challengeId: ChallengeId): Promise<void> {
    return await this.command((requestId) => ({
      type: "joinWorldChallenge",
      requestId,
      challengeId,
    }));
  }

  async leaveChallenge(challengeId: ChallengeId): Promise<void> {
    return await this.command((requestId) => ({
      type: "leaveWorldChallenge",
      requestId,
      challengeId,
    }));
  }

  /** @internal Receives a complete public World projection. */
  receiveSnapshot(snapshot: WorldSnapshot): void {
    if (this.closed) return;
    this.resyncRequested = false;
    this.state.replaceSnapshot(snapshot);
    if (!this.readyResolved) {
      this.readyResolved = true;
      this.resolveReady(this.state);
    }
  }

  /** @internal Receives a revision-linked World mutation. */
  receiveDelta(delta: WorldDelta): void {
    if (this.closed || this.resyncRequested) return;
    if (!this.state.applyDelta(delta)) {
      this.resyncRequested = true;
      this.client.sendNetworkMessage({ type: "requestWorldSnapshot" });
    }
  }

  /** @internal Resolves one command response from the parent socket. */
  receiveCommandResult(
    requestId: RequestId,
    reason: WorldCommandRejectionReason | null,
  ): void {
    const command = this.pending.get(requestId);
    if (command === undefined) return;
    this.pending.delete(requestId);
    if (reason === null) command.resolve();
    else command.reject(new WorldCommandRejectedError(reason));
  }

  /** @internal Ends the stream and rejects commands awaiting an acknowledgement. */
  terminate(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.readyResolved) {
      this.readyResolved = true;
      this.rejectReady(error);
    }
    for (const command of this.pending.values()) command.reject(error);
    this.pending.clear();
  }

  private async command(
    createMessage: (
      requestId: RequestId,
    ) =>
      | { type: "challengeWorldCell"; requestId: RequestId; position: Position }
      | { type: "joinWorldChallenge"; requestId: RequestId; challengeId: ChallengeId }
      | { type: "leaveWorldChallenge"; requestId: RequestId; challengeId: ChallengeId },
  ): Promise<void> {
    if (this.closed) throw new Error("NetworkWorldSession has been closed");
    const requestId = this.client.createRequestId();
    const result = new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    try {
      this.client.sendNetworkMessage(createMessage(requestId));
    } catch (error) {
      this.pending.delete(requestId);
      throw error;
    }
    return await result;
  }
}
