import type { BattleCommandRejection } from "@grid-game/client/headless";
import type {
  BattleId,
  BattleParticipantId,
  BattleSnapshot,
  Position,
  Tick,
} from "@grid-game/shared";

/** Recursively read-only data exposed to strategies. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** The intentionally small action surface available to v1 strategies. */
export type BotAction = Readonly<{
  type: "incrementCell";
  position: Position;
}>;

/** Immutable authoritative battle facts supplied for one decision. */
export type BotBattleState = Readonly<{
  snapshot: DeepReadonly<BattleSnapshot>;
  localParticipantId: BattleParticipantId;
  estimatedTick: Tick;
  hasLocalCommandPending: boolean;
  latestRejection: DeepReadonly<BattleCommandRejection> | null;
}>;

/** A synchronous strategy with no access to transport or mutable client state. */
export interface Bot {
  decide(state: BotBattleState): BotAction | null;
}

export type BotFactoryContext = Readonly<{
  battleId: BattleId;
  localParticipantId: BattleParticipantId;
}>;

/** Creates independent strategy state for each joined battle. */
export type BotFactory = (context: BotFactoryContext) => Bot;
