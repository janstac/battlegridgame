import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

type ThemeContextValue = Readonly<{
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
}>;

const ThemeContext = createContext<ThemeContextValue | null>(null);
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function deviceTheme(): ResolvedTheme {
  return globalThis.matchMedia?.(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(deviceTheme);

  useEffect(() => {
    const query = globalThis.matchMedia?.(DARK_SCHEME_QUERY);
    if (query === undefined) return;
    const update = () => setSystemTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") delete root.dataset.theme;
    else root.dataset.theme = preference;
    return () => {
      delete root.dataset.theme;
    };
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme: preference === "system" ? systemTheme : preference,
    setPreference,
  }), [preference, systemTheme]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
