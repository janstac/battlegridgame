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
  if (cooldown === undefined) return { remainingTicks: 0, ratio: 0 };

  const remainingTicks = Number.isFinite(estimatedTick)
    && Number.isFinite(cooldown.nextActionTick)
    ? Math.max(0, cooldown.nextActionTick - estimatedTick)
    : 0;
  if (
    remainingTicks === 0
    || !Number.isFinite(cooldown.durationTicks)
    || cooldown.durationTicks <= 0
  ) {
    return { remainingTicks, ratio: 0 };
  }
  return {
    remainingTicks,
    ratio: Math.max(0, Math.min(1, remainingTicks / cooldown.durationTicks)),
  };
}
