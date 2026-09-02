"use client";

import { useEffect, useState } from "react";
import { LogoPlanet } from "@/components/ui/logo";

interface SplashScreenProps {
  /** Total time the splash is visible, in ms. Default 2400ms. */
  duration?: number;
  /** Re-render the splash each session (vs only the very first visit). */
  everySession?: boolean;
}

/**
 * Lightweight, no-dependency splash screen with a single coordinated
 * timeline:
 *
 *   0ms          planet pops in (700ms) and starts spinning (one full
 *                rotation over 1800ms, then holds)
 *   150ms        wordmark fades in (700ms)
 *   duration-450 splash fades out (450ms) — animation and the hide timer
 *                finish together so there is never an abrupt cut
 *
 * Honoured accessibility concerns:
 *   - `prefers-reduced-motion` → animations collapse to a hard cut.
 *   - `aria-hidden` while visible so screen readers ignore the decoration.
 */
export function SplashScreen({
  duration = 2400,
  everySession = false,
}: SplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const hide = () => {
      setVisible(false);
    };

    if (reduceMotion) {
      const t = window.setTimeout(hide, 250);
      return () => window.clearTimeout(t);
    }

    // Single timer aligned with the CSS fade-out (450ms, see style below).
    const timer = window.setTimeout(hide, duration);
    return () => window.clearTimeout(timer);
  }, [duration, everySession]);

  if (!mounted || !visible) return null;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
      style={{
        animation: "permamind-splash-fade-out 450ms ease-in-out forwards",
        animationDelay: `${Math.max(0, duration - 450)}ms`,
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          animation:
            "permamind-splash-pop 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        {/* Soft glow behind the planet */}
        <span
          aria-hidden
          className="absolute size-40 rounded-full bg-primary/20 blur-3xl"
        />
        <LogoPlanet
          size={180}
          decorative
          className="relative text-foreground"
          style={{
            animation:
              "permamind-splash-spin 1800ms cubic-bezier(0.4, 0, 0.2, 1) 1 forwards",
          }}
        />
      </div>
    </div>
  );
}
