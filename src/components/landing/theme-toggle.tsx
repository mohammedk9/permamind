"use client";

import { Moon, Sun } from "lucide-react";

import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";

interface ThemeToggleProps {
  triggerClassName?: string;
  className?: string;
  /** Compact square button for a header; full label button for the sidebar. */
  variant?: "button" | "icon";
}

/**
 * Light/dark switch.
 *
 * Rendered next to the language toggle on the landing header and in the app
 * sidebar, because a theme the user cannot change is a theme they cannot keep.
 * The icon shows the theme that is currently active, and `aria-pressed` states
 * it for assistive tech, so the control reads correctly without seeing colour.
 */
export function ThemeToggle({
  triggerClassName,
  className,
  variant = "button",
}: ThemeToggleProps) {
  const { locale } = useLocale();
  const { isDark, toggleTheme } = useTheme();
  const ar = locale === "ar";

  const label = ar
    ? isDark
      ? "التبديل إلى الوضع النهاري"
      : "التبديل إلى الوضع الليلي"
    : isDark
      ? "Switch to light mode"
      : "Switch to dark mode";

  const Icon = isDark ? Moon : Sun;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        aria-pressed={isDark}
        className={className}
      >
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className={triggerClassName ?? className}
    >
      <Icon className="size-4" />
    </button>
  );
}