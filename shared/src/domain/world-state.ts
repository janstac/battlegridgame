import Type from "typebox";

import { PositionSchema, type Position } from "./coordinate.ts";
import { SerializedGridSchema, type SerializedGrid } from "./grid.ts";
import {
  WorldRevisionSchema,
  type WorldRevision,
} from "./ids.ts";
import {
  WorldCellSchema,
  copyWorldCell,
  type WorldCell,
} from "./world-cell.ts";

/** Complete public state of the fixed-size World at one revision. */
export const WorldSnapshotSchema = Type.Object(
  {
    revision: WorldRevisionSchema,
    grid: SerializedGridSchema(WorldCellSchema),
  },
  { additionalProperties: false },
);
export type WorldSnapshot = Type.Static<typeof WorldSnapshotSchema>;

/** One cell replacement within an atomic World mutation. */
export const WorldCellChangeSchema = Type.Object(
  {
    position: PositionSchema,
    cell: WorldCellSchema,
  },
  { additionalProperties: false },
);
export type WorldCellChange = Type.Static<typeof WorldCellChangeSchema>;

/** An atomic batch moving a World projection between two revisions. */
export const WorldDeltaSchema = Type.Object(
  {
    fromRevision: WorldRevisionSchema,
    revision: WorldRevisionSchema,
    changes: Type.Array(WorldCellChangeSchema),
  },
  { additionalProperties: false },
);
export type WorldDelta = Type.Static<typeof WorldDeltaSchema>;

/** Successful application or a recoverable signal that a snapshot is needed. */
export type WorldDeltaApplication =
  | { kind: "applied"; snapshot: WorldSnapshot }
  | {
      kind: "revisionGap";
      expectedRevision: WorldRevision;
      receivedFromRevision: WorldRevision;
    };

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function assertWellFormedGrid(grid: SerializedGrid<WorldCell>): void {
  if (grid.cells.length !== grid.width * grid.height) {
    throw new RangeError(
      `World grid contains ${grid.cells.length} cells; expected ${grid.width * grid.height}`,
    );
  }
}

/**
 * Purely applies an authoritative delta to a snapshot.
 *
 * A revision mismatch is recoverable and asks the caller to request a fresh
 * snapshot. Structurally valid but internally inconsistent deltas throw because
 * they indicate a server/protocol defect rather than packet loss.
 */
export function applyWorldDelta(
  snapshot: WorldSnapshot,
  delta: WorldDelta,
): WorldDeltaApplication {
  if (delta.fromRevision !== snapshot.revision) {
    return {
      kind: "revisionGap",
      expectedRevision: snapshot.revision,
      receivedFromRevision: delta.fromRevision,
    };
  }
  if (delta.revision <= delta.fromRevision) {
    throw new RangeError("A World delta must advance the revision");
  }

  assertWellFormedGrid(snapshot.grid);
  const cells = snapshot.grid.cells.map(copyWorldCell);
  const changedPositions = new Set<string>();

  for (const change of delta.changes) {
    if (
      change.position.x >= snapshot.grid.width
      || change.position.y >= snapshot.grid.height
    ) {
      throw new RangeError(
        `World delta position ${positionKey(change.position)} is out of bounds`,
      );
    }
    const key = positionKey(change.position);
    if (changedPositions.has(key)) {
      throw new RangeError(`World delta contains duplicate position ${key}`);
    }
    changedPositions.add(key);
    const index = change.position.y * snapshot.grid.width + change.position.x;
    cells[index] = copyWorldCell(change.cell);
  }

  return {
    kind: "applied",
    snapshot: {
      revision: delta.revision,
      grid: {
        width: snapshot.grid.width,
        height: snapshot.grid.height,
        cells,
      },
    },
  };
}
