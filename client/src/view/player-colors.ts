import type { PlayerId } from "@grid-game/shared";

/** Presentation colors assigned deterministically by participant order. */
export type PlayerColors = Readonly<{
  fill: string;
  stroke: string;
  text: string;
}>;

const GOLDEN_ANGLE = 137.507764;

function hueForIndex(index: number): number {
  return (218 + index * GOLDEN_ANGLE) % 360;
}

function playerIndex(playerId: PlayerId, players: readonly PlayerId[]): number {
  const index = players.indexOf(playerId);
  if (index >= 0) {
    return index;
  }

  // Keep unexpected IDs stable without collapsing every one to the first color.
  let hash = 0;
  for (const character of playerId) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  }
  return hash;
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1 ? [chroma, intermediate, 0]
    : sector < 2 ? [intermediate, chroma, 0]
    : sector < 3 ? [0, chroma, intermediate]
    : sector < 4 ? [0, intermediate, chroma]
    : sector < 5 ? [intermediate, 0, chroma]
    : [chroma, 0, intermediate];
  const offset = lightness - chroma / 2;
  return (
    0.2126 * channelToLinear((red + offset) * 255) +
    0.7152 * channelToLinear((green + offset) * 255) +
    0.0722 * channelToLinear((blue + offset) * 255)
  );
}

/** Returns stable player colors without placing display concerns in game state. */
export function colorsForPlayer(
  playerId: PlayerId,
  players: readonly PlayerId[],
): PlayerColors {
  const index = playerIndex(playerId, players);
  // A golden-angle sequence keeps adjacent player colors far apart and avoids
  // the silent repetition of a finite palette for larger battles.
  const hue = hueForIndex(index);
  const saturation = 0.68;
  const lightness = 0.46 + (index % 3) * 0.035;
  const luminance = hslLuminance(hue, saturation, lightness);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  const fill = `hsl(${hue.toFixed(2)} 68% ${(lightness * 100).toFixed(1)}%)`;
  return {
    fill,
    stroke:
      luminance > 0.4
        ? `hsl(${hue.toFixed(2)} 72% 22%)`
        : `hsl(${hue.toFixed(2)} 78% 82%)`,
    // Black or white always provides at least WCAG AA contrast at this size;
    // calculate rather than guessing because yellow and cyan are unusually bright.
    text: blackContrast >= whiteContrast ? "#000000" : "#ffffff",
  };
}
