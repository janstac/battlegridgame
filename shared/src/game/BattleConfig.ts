/** Tunable deterministic rules for one battle engine. */
export type BattleConfig = {
  splitDelayTicks: number;
};

/** Baseline rules used by the demo and simple server sessions. */
export const DEFAULT_BATTLE_CONFIG: Readonly<BattleConfig> = {
  splitDelayTicks: 10,
};
