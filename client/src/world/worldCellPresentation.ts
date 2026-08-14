import type { PlayerId, WorldCell } from "@grid-game/shared";

export type WorldChallengeCell = Extract<
  WorldCell,
  { kind: "challengePending" | "challengeWaiting" }
>;

export const WAITING_CHALLENGE_DESCRIPTION =
  "Waiting for all participants to have room for another battle.";

function unreachableWorldCell(cell: never): never {
  throw new Error(`Unsupported World cell: ${JSON.stringify(cell)}`);
}

export function isWorldChallengeCell(cell: WorldCell): cell is WorldChallengeCell {
  return cell.kind === "challengePending" || cell.kind === "challengeWaiting";
}

export function isWorldCellActionable(
  cell: WorldCell,
  localPlayerId: PlayerId,
): boolean {
  switch (cell.kind) {
    case "unoccupied":
    case "battle":
      return false;
    case "occupied":
      return cell.playerId !== localPlayerId;
    case "challengePending":
    case "challengeWaiting":
      return true;
    default:
      return unreachableWorldCell(cell);
  }
}

export function worldCellLabel(cell: WorldCell, now: number): string {
  switch (cell.kind) {
    case "unoccupied":
      return "";
    case "occupied":
      return "●";
    case "challengePending":
      return `${Math.max(0, Math.ceil((cell.closesAt - now) / 1_000))}s`;
    case "challengeWaiting":
      return "Waiting";
    case "battle":
      return "⚔";
    default:
      return unreachableWorldCell(cell);
  }
}

export function worldCellDescription(
  cell: WorldCell,
  column: number,
  row: number,
): string {
  const prefix = `Cell ${column}, ${row}`;
  switch (cell.kind) {
    case "unoccupied":
      return `${prefix}, unoccupied`;
    case "occupied":
      return `${prefix}, occupied by ${cell.playerId}`;
    case "challengePending":
      return `${prefix}, challenge pending with ${cell.participantIds.length} players`;
    case "challengeWaiting":
      return `${prefix}, challenge waiting for battle capacity with ${cell.participantIds.length} players`;
    case "battle":
      return `${prefix}, battle with ${cell.playerIds.length} players`;
    default:
      return unreachableWorldCell(cell);
  }
}

export function worldDetailHeading(
  cell: WorldCell,
  localPlayerId: PlayerId,
): string {
  switch (cell.kind) {
    case "unoccupied":
      return "Unoccupied";
    case "occupied":
      return cell.playerId === localPlayerId ? "Your cell" : `Owned by ${cell.playerId}`;
    case "challengePending":
      return "Challenge gathering players";
    case "challengeWaiting":
      return "Challenge waiting for battle capacity";
    case "battle":
      return "Battle in progress";
    default:
      return unreachableWorldCell(cell);
  }
}
