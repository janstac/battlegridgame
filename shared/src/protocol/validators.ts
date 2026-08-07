import Schema from "typebox/schema";

import { assertValidBattleSnapshot } from "../domain/index.ts";
import {
  ClientMessageSchema,
  type ClientMessage,
} from "./client-messages.ts";
import {
  ServerMessageSchema,
  type ServerMessage,
} from "./server-messages.ts";

/** Compiled validator for untrusted client messages. */
export const ClientMessageValidator = Schema.Compile(ClientMessageSchema);
const StructuralServerMessageValidator = Schema.Compile(ServerMessageSchema);

/**
 * Validator for untrusted server messages.
 *
 * Unlike a schema-only validator, this also enforces cross-field snapshot
 * invariants such as grid size, participant ownership, and queue uniqueness.
 */
export const ServerMessageValidator = {
  /** Checks both the TypeBox structure and semantic snapshot invariants. */
  Check(value: unknown): value is ServerMessage {
    if (!StructuralServerMessageValidator.Check(value)) {
      return false;
    }
    try {
      assertServerMessageSemantics(value);
      return true;
    } catch {
      return false;
    }
  },

  /** Parses a message, throwing a detailed validation error when invalid. */
  Parse(value: unknown): ServerMessage {
    const message = StructuralServerMessageValidator.Parse(value);
    assertServerMessageSemantics(message);
    return message;
  },
};

/** Narrows an unknown value after validating the complete client schema. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return ClientMessageValidator.Check(value);
}

/** Narrows an unknown value after validating the complete server schema. */
export function isServerMessage(value: unknown): value is ServerMessage {
  return ServerMessageValidator.Check(value);
}

/** Validates and returns a client message, throwing on invalid input. */
export function parseClientMessage(value: unknown): ClientMessage {
  return ClientMessageValidator.Parse(value);
}

/** Validates and returns a server message, throwing on invalid input. */
export function parseServerMessage(value: unknown): ServerMessage {
  return ServerMessageValidator.Parse(value);
}

function assertServerMessageSemantics(message: ServerMessage): void {
  // Rejected commands carry no state; every other message must prove that its
  // authoritative snapshot is internally restorable before reaching a client.
  switch (message.type) {
    case "battleSnapshot":
    case "commandAccepted":
    case "battleAdvanced":
      assertValidBattleSnapshot(message.snapshot);
      return;
    case "commandRejected":
      return;
    default:
      assertNeverServerMessage(message);
  }
}

function assertNeverServerMessage(message: never): never {
  throw new TypeError(
    `Unsupported server message type: ${String((message as { type?: unknown }).type)}`,
  );
}
