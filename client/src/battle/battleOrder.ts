import type { BattleId } from "@grid-game/shared";

export function moveBattle(
  order: readonly BattleId[],
  battleId: BattleId,
  direction: -1 | 1,
): readonly BattleId[] {
  const index = order.indexOf(battleId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
