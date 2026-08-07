import type { PlayerId } from "@grid-game/shared";

/** Presentation colors assigned deterministically by participant order. */
export type PlayerColors = Readonly<{
  fill: string;
  stroke: string;
  text: string;
}>;

const PALETTE: readonly PlayerColors[] = [
  { fill: "#4f7cff", stroke: "#adc3ff", text: "#ffffff" },
  { fill: "#ec5f74", stroke: "#ffc0c8", text: "#ffffff" },
  { fill: "#e9a23b", stroke: "#ffe0a3", text: "#1a2130" },
  { fill: "#36b98a", stroke: "#a8efd5", text: "#0d2b23" },
];

/** Returns stable player colors without placing display concerns in game state. */
export function colorsForPlayer(
  playerId: PlayerId,
  players: readonly PlayerId[],
): PlayerColors {
  const index = players.indexOf(playerId);
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length] ?? PALETTE[0]!;
}
