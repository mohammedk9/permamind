"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/hooks/use-locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  useLocale();
  return children;
}