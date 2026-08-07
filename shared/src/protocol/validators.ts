import Schema from "typebox/schema";

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
/** Compiled validator for untrusted server messages. */
export const ServerMessageValidator = Schema.Compile(ServerMessageSchema);

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
