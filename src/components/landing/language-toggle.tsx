"use client";

import { Globe } from "lucide-react";
import { Locale } from "@/lib/i18n/translations";

interface LanguageToggleProps {
  locale: Locale;
  onToggle: () => void;
  label: string;
}

export function LanguageToggle({ locale, onToggle, label }: LanguageToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label={`Switch language to ${locale === "en" ? "Arabic" : "English"}`}
    >
      <Globe className="size-4" />
      <span>{label}</span>
    </button>
  );
}