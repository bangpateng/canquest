"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "canquest-theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** App ini LIGHT-ONLY (permintaan produk: background putih semua).
 *  Provider tetap dipertahankan karena konsumen `useTheme()` ada (mis. logo
 *  wordmark memilih varian terang/gelap) — nilai `theme` selalu "light". */
function readStoredTheme(): Theme {
  return "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme === "dark" ? "light" : "light");
  root.style.colorScheme = "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  // Light-only: setter disediakan demi kompatibilitas API, tapi selalu
  // mengembalikan ke light dan tidak pernah menulis preferensi gelap.
  const setTheme = useCallback((_next: Theme) => {
    setThemeState("light");
    applyTheme("light");
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState("light");
    applyTheme("light");
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
