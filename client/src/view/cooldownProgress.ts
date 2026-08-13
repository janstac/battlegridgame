import type { ParticipantCooldown } from "@grid-game/shared";

export type CooldownProgress = Readonly<{
  remainingTicks: number;
  ratio: number;
}>;

/** Derives reconnect-safe cooldown progress from authoritative snapshot timing. */
export function cooldownProgress(
  cooldown: ParticipantCooldown | undefined,
  estimatedTick: number,
): CooldownProgress {
  const remainingTicks = Math.max(0, (cooldown?.nextActionTick ?? 0) - estimatedTick);
  if (cooldown === undefined || cooldown.durationTicks === 0) {
    return { remainingTicks, ratio: 0 };
  }
  return {
    remainingTicks,
    ratio: Math.min(1, remainingTicks / cooldown.durationTicks),
  };
}
