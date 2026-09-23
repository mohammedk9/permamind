"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { Logo } from "@/components/ui/logo";
import { useLocale } from "@/hooks/use-locale";
import { translations } from "@/lib/i18n/translations";

type PolicyKind = "privacy" | "terms";

export function LegalPage({ kind }: { kind: PolicyKind }) {
  const { locale, toggleLocale, isRTL } = useLocale();
  const t = translations[locale];
  const title = kind === "privacy" ? t.privacyTitle : t.termsTitle;
  const description = kind === "privacy" ? t.privacyDescription : t.termsDescription;
  const sections = kind === "privacy" ? t.privacySections : t.termsSections;

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
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className={`size-4 ${isRTL ? "" : "rotate-180"}`} />
          {t.legalBack}
        </Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t.legalUpdated} · 2026
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">{description}</p>

        <div className="mt-10 divide-y divide-border/70 border-y border-border/70">
          {sections.map((section) => (
            <section key={section.title} className="py-6">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </article>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} PermaMind. {t.footerRights}</p>
          <nav className="flex gap-5">
            <Link href="/privacy" className="transition-colors hover:text-foreground">{t.footerPrivacy}</Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">{t.footerTerms}</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
