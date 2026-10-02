"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "permamind-theme";
const THEME_EVENT = "permamind-theme-change";

/** Class the Tailwind `dark:` variant is keyed off. */
const DARK_CLASS = "dark";

/**
 * Reads the stored preference, falling back to the operating system.
 *
 * This is the browser half of the theme switch. The server render must already
 * carry a resolved class, so `layout.tsx` runs a blocking inline script before
 * paint; duplicating this fallback here is what keeps the two in agreement when
 * localStorage is empty.
 */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(stored: Theme | null, system: Theme): Theme {
  return stored ?? system;
}

/** Applies the class and keeps native form controls and scrollbars in step. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, theme === "dark");
  // Without this the browser keeps painting scrollbars and `<select>` menus
  // with the palette it booted with, which looks like a broken half-theme.
  root.style.colorScheme = theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Only the stored preference is authoritative on mount. Re-deriving from
  // `systemTheme()` here would flash the wrong theme on a user who explicitly
  // chose the other one, because the effect runs after the first paint.
  useEffect(() => {
    const next = resolveTheme(readStoredTheme(), systemTheme());
    setThemeState(next);
    applyTheme(next);

    // Follow the OS while the user has not made an explicit choice. Listening
    // only once would leave the app stuck on a stale value after the user
    // changes their system appearance mid-session.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (readStoredTheme() !== null) return;
      const next = systemTheme();
      setThemeState(next);
      applyTheme(next);
    };
    media.addEventListener("change", handleSystemChange);

    // A second theme control in another tab changed the preference.
    const handleThemeChange = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next === "light" || next === "dark") {
        setThemeState(next);
        applyTheme(next);
      }
    };
    window.addEventListener(THEME_EVENT, handleThemeChange);

    return () => {
      media.removeEventListener("change", handleSystemChange);
      window.removeEventListener(THEME_EVENT, handleThemeChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}