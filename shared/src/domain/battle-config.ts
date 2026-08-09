import Type from "typebox";

import { SAFE_INTEGER_MAX } from "./coordinate.ts";

/** Runtime schema for immutable timing rules shared by an engine and its clients. */
export const BattleConfigSchema = Type.Object(
  {
    ticksPerSecond: Type.Number({ exclusiveMinimum: 0 }),
    splitDelayTicks: Type.Integer({ minimum: 1, maximum: SAFE_INTEGER_MAX }),
  },
  { additionalProperties: false },
);

/** Immutable deterministic configuration for one battle simulation. */
export type BattleConfig = Type.Static<typeof BattleConfigSchema>;

/** Baseline rules used by the demo and simple server sessions. */
export const DEFAULT_BATTLE_CONFIG: Readonly<BattleConfig> = {
  ticksPerSecond: 20,
  splitDelayTicks: 10,
};
