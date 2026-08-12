import Schema from "typebox/schema";

import { WorldCellSchema, type WorldCell } from "../domain/world-cell.ts";
import {
  WorldDeltaSchema,
  WorldSnapshotSchema,
  type WorldDelta,
  type WorldSnapshot,
} from "../domain/world-state.ts";
import {
  ClientMessageSchema,
  type ClientMessage,
} from "./client-messages.ts";
import {
  ServerMessageSchema,
  type ServerMessage,
} from "./server-messages.ts";
import {
  NetworkClientMessageSchema,
  NetworkServerMessageSchema,
  type NetworkClientMessage,
  type NetworkServerMessage,
} from "./network-messages.ts";

/** Compiled validator for untrusted client messages. */
export const ClientMessageValidator = Schema.Compile(ClientMessageSchema);
export const ServerMessageValidator = Schema.Compile(ServerMessageSchema);
export const NetworkClientMessageValidator = Schema.Compile(NetworkClientMessageSchema);
export const NetworkServerMessageValidator = Schema.Compile(NetworkServerMessageSchema);
export const WorldCellValidator = Schema.Compile(WorldCellSchema);
export const WorldSnapshotValidator = Schema.Compile(WorldSnapshotSchema);
export const WorldDeltaValidator = Schema.Compile(WorldDeltaSchema);
const StructuralServerMessageValidator = Schema.Compile(ServerMessageSchema);

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
  return StructuralServerMessageValidator.Parse(value);
}

export function parseNetworkClientMessage(value: unknown): NetworkClientMessage {
  return NetworkClientMessageValidator.Parse(value);
}

export function parseNetworkServerMessage(value: unknown): NetworkServerMessage {
  return NetworkServerMessageValidator.Parse(value);
}

export function parseWorldCell(value: unknown): WorldCell {
  return WorldCellValidator.Parse(value);
}

export function parseWorldSnapshot(value: unknown): WorldSnapshot {
  return WorldSnapshotValidator.Parse(value);
}

export function parseWorldDelta(value: unknown): WorldDelta {
  return WorldDeltaValidator.Parse(value);
}
