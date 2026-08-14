import Schema from "typebox/schema";

import {
  AdminConnectionServerMessageSchema,
  AdminNetworkClientMessageSchema,
  AdminNetworkServerMessageSchema,
  AnonymousNetworkClientMessageSchema,
  ConnectedAsAdminMessageSchema,
  type AdminConnectionServerMessage,
  type AdminNetworkClientMessage,
  type AdminNetworkServerMessage,
  type AnonymousNetworkClientMessage,
  type ConnectedAsAdminMessage,
} from "./admin-messages.ts";

export const AnonymousNetworkClientMessageValidator = Schema.Compile(
  AnonymousNetworkClientMessageSchema,
);
export const ConnectedAsAdminMessageValidator = Schema.Compile(
  ConnectedAsAdminMessageSchema,
);
const StructuralAdminNetworkClientMessageValidator = Schema.Compile(
  AdminNetworkClientMessageSchema,
);
export const AdminNetworkServerMessageValidator = Schema.Compile(
  AdminNetworkServerMessageSchema,
);
export const AdminConnectionServerMessageValidator = Schema.Compile(
  AdminConnectionServerMessageSchema,
);

function assertUniqueReplacementPositions(
  message: AdminNetworkClientMessage,
): void {
  if (message.type !== "adminReplaceWorldCells") {
    return;
  }

  const positions = new Set<string>();
  for (const change of message.changes) {
    const key = `${change.position.x},${change.position.y}`;
    if (positions.has(key)) {
      throw new TypeError(`Duplicate world cell position: ${key}`);
    }
    positions.add(key);
  }
}

export const AdminNetworkClientMessageValidator = {
  Check(value: unknown): value is AdminNetworkClientMessage {
    if (!StructuralAdminNetworkClientMessageValidator.Check(value)) {
      return false;
    }

    try {
      assertUniqueReplacementPositions(value);
      return true;
    } catch {
      return false;
    }
  },
  Parse(value: unknown): AdminNetworkClientMessage {
    const message = StructuralAdminNetworkClientMessageValidator.Parse(value);
    assertUniqueReplacementPositions(message);
    return message;
  },
};

export function parseAnonymousNetworkClientMessage(
  value: unknown,
): AnonymousNetworkClientMessage {
  return AnonymousNetworkClientMessageValidator.Parse(value);
}

export function parseConnectedAsAdminMessage(
  value: unknown,
): ConnectedAsAdminMessage {
  return ConnectedAsAdminMessageValidator.Parse(value);
}

export function parseAdminNetworkClientMessage(
  value: unknown,
): AdminNetworkClientMessage {
  return AdminNetworkClientMessageValidator.Parse(value);
}

export function parseAdminNetworkServerMessage(
  value: unknown,
): AdminNetworkServerMessage {
  return AdminNetworkServerMessageValidator.Parse(value);
}

export function parseAdminConnectionServerMessage(
  value: unknown,
): AdminConnectionServerMessage {
  return AdminConnectionServerMessageValidator.Parse(value);
}
