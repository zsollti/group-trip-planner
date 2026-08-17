import { useCallback, useEffect, useState } from "react";
import { t } from "./i18n";

/**
 * Manual light/dark theme (Phase 3.5). The board defaults to the OS setting
 * (`prefers-color-scheme`); a stored choice overrides it by stamping
 * `data-theme` on <html>, which the CSS tokens key off. `null` = follow the OS.
 */
export type ThemeChoice = "light" | "dark";

const KEY = "gtp-board-theme";

export function getStoredTheme(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Stamp (or clear) the manual choice on <html>. Called at startup and on toggle. */
export function applyTheme(choice: ThemeChoice | null): void {
  const root = document.documentElement;
  if (choice) root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");
}

function osPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(t("(prefers-color-scheme: dark)")).matches
  );
}

/**
 * The current resolved theme + a toggle. `resolved` is what's actually showing
 * (the stored choice, or the OS default when none). Toggling always writes an
 * explicit choice, so it flips relative to whatever is on screen.
 */
export function useTheme(): { resolved: ThemeChoice; toggle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice | null>(() =>
    getStoredTheme(),
  );

  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  const resolved: ThemeChoice = choice ?? (osPrefersDark() ? "dark" : "light");

  const toggle = useCallback(() => {
    setChoice((prev) => {
      const current = prev ?? (osPrefersDark() ? "dark" : "light");
      const next: ThemeChoice = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore storage failures (private mode) */
      }
      return next;
    });
  }, []);

  return { resolved, toggle };
}
