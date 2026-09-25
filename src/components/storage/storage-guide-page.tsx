"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { Logo } from "@/components/ui/logo";
import { useLocale } from "@/hooks/use-locale";
import { translations } from "@/lib/i18n/translations";

export function StorageGuidePage() {
  const { locale, toggleLocale, isRTL } = useLocale();
  const t = translations[locale];

  return (
    <main dir={isRTL ? "rtl" : "ltr"} className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="PermaMind home">
            <Logo size="md" withWordmark />
          </Link>
          <LanguageToggle locale={locale} onToggle={toggleLocale} label={t.languageToggle} />
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <Link
          href="/backup"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className={`size-4 ${isRTL ? "" : "rotate-180"}`} />
          {t.storageGuideBack}
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight sm:text-4xl">{t.storageGuideTitle}</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">{t.storageGuideDescription}</p>

        <div className="mt-10 divide-y divide-border/70 border-y border-border/70">
          {t.storageGuideSections.map((section) => (
            <section key={section.title} className="py-6">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
