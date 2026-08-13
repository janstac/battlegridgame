import type { ThemePreference } from "./ThemeProvider.tsx";
import { useTheme } from "./ThemeProvider.tsx";
import styles from "./ThemeControl.module.css";

const OPTIONS: readonly Readonly<{ value: ThemePreference; label: string }>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className={styles.control}>
      <legend className={styles.legend}>Colour theme</legend>
      {OPTIONS.map(({ value, label }) => (
        <label className={styles.option} key={value}>
          <input
            type="radio"
            name="colour-theme"
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
