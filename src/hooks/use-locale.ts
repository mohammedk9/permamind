"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/translations";

const STORAGE_KEY = "permamind-locale";
const LOCALE_EVENT = "permamind-locale-change";

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ar" || saved === "en") setLocaleState(saved);

    const handleLocaleChange = (event: Event) => {
      const next = (event as CustomEvent<Locale>).detail;
      if (next === "ar" || next === "en") setLocaleState(next);
    };

    window.addEventListener(LOCALE_EVENT, handleLocaleChange);
    return () => window.removeEventListener(LOCALE_EVENT, handleLocaleChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  function setLocale(next: Locale) {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent<Locale>(LOCALE_EVENT, { detail: next }));
  }

  function toggleLocale() {
    setLocale(locale === "en" ? "ar" : "en");
  }

  return { locale, setLocale, toggleLocale, isRTL: locale === "ar" };
}