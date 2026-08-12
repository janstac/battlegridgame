import styles from "./BattleSvgDefinitions.module.css";

/** Document-global ID for the shared wall-cell geometry. */
export const WALL_SYMBOL_ID = "battle-wall-symbol";

/** Document-global ID for the shared pending-split geometry. */
export const PENDING_SYMBOL_ID = "battle-pending-symbol";

/** Defines reusable battle SVG geometry once at the application root. */
export function BattleSvgDefinitions() {
  return (
    <svg className={styles.definitions} width="0" height="0">
      <defs>
        <symbol id={WALL_SYMBOL_ID} viewBox="0 0 1 1">
          <path
            d="M .2 .28 H .8 M .2 .5 H .8 M .2 .72 H .8 M .34 .28 V .5 M .66 .5 V .72"
            fill="none"
            stroke="currentColor"
          />
        </symbol>
        <symbol id={PENDING_SYMBOL_ID} viewBox="0 0 1 1">
          <circle cx="0.78" cy="0.2" r="0.09" />
        </symbol>
      </defs>
    </svg>
  );
}
