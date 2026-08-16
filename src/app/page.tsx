"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Brain,
  Globe,
  Search,
  Shield,
  ArrowRight,
  MessageSquare,
  Database,
  Sparkles,
  Lock,
} from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { Locale, translations } from "@/lib/i18n/translations";

const featureIcons = {
  brain: Brain,
  search: Search,
  shield: Shield,
  globe: Globe,
} as const;

const stepIcons = [MessageSquare, Database, Sparkles, Lock] as const;

export default function LandingPage() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("permamind-locale") as Locale | null;
    if (saved === "ar" || saved === "en") setLocale(saved);
  }, []);

  const toggleLocale = () => {
    const next = locale === "en" ? "ar" : "en";
    setLocale(next);
    localStorage.setItem("permamind-locale", next);
  };

  const t = translations[locale];
  const isRTL = locale === "ar";

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-dvh overflow-y-auto bg-background text-foreground"
    >
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              P
            </div>
            <span className="text-lg font-semibold">PermaMind</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle
              locale={locale}
              onToggle={toggleLocale}
              label={t.languageToggle}
            />
            <Link
              href="/auth/sign-in"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              {t.signIn}
            </Link>
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t.signUp}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
              <Sparkles className="size-4 text-primary" />
              {t.heroBadge}
            </div>

            {/* Title */}
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              {t.heroTitle}{" "}
              <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                {t.heroTitleHighlight}
              </span>{" "}
              {t.heroTitleEnd}
            </h1>

            {/* Description */}
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {t.heroDescription}
            </p>

            {/* CTA Buttons */}
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/auth/sign-up"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto"
              >
                {t.heroCta}
                <ArrowRight
                  className={`size-4 ${isRTL ? "rotate-180" : ""}`}
                />
              </Link>
              <a
                href="#features"
                className="flex w-full items-center justify-center rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:w-auto"
              >
                {t.heroSecondary}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Product proof section */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t.proofLabel}
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {t.trustTitle}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t.trustDescription}
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {t.trustItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-primary/20 bg-card p-5 shadow-2xl shadow-primary/5 sm:p-7">
            <div className="mb-5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" />
              PermaMind memory recall
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t.proofQuestion}</p>
            <div className="mt-5 rounded-2xl bg-primary/10 p-4 text-sm leading-7">
              {t.proofAnswer}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t.proofSource}</p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-t border-border/50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t.featuresTitle}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t.featuresDescription}
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {t.features.map((feature) => {
              const Icon = featureIcons[feature.icon as keyof typeof featureIcons];
              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-6" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* MCP integration section */}
      <section className="border-t border-border/50 py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">MCP · Cursor · Claude · Codex</p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t.mcpTitle}</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{t.mcpDescription}</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {t.mcpPoints.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm font-medium">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">✓</span>
                  {point}
                </li>
              ))}
            </ul>
            <Link href="/auth/sign-up" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              {t.mcpCta}<ArrowRight className={`size-4 ${isRTL ? "rotate-180" : ""}`} />
            </Link>
          </div>
          <div className="rounded-3xl border border-primary/20 bg-card p-6 shadow-xl shadow-primary/5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">MCP</div>
              <div><p className="font-semibold">Read-only memory bridge</p><p className="text-sm text-muted-foreground">PermaMind → Cursor / Claude / Codex</p></div>
            </div>
            <div className="mt-6 rounded-xl border bg-muted/30 p-4 font-mono text-xs text-muted-foreground">https://your-domain.com/api/mcp</div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{isRTL ? "يتم الاتصال بعد تسجيل الدخول وبموافقتك على الملخصات التي تريد مشاركتها." : "Connect after signing in and explicitly approve the summaries you want to share."}</p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="border-t border-border/50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t.howItWorksTitle}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t.howItWorksDescription}
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {t.steps.map((step, index) => {
              const StepIcon = stepIcons[index];
              return (
                <div key={step.title} className="relative text-center">
                  {/* Connector line */}
                  {index < t.steps.length - 1 && (
                    <div
                      className={`absolute top-8 hidden h-px w-full bg-gradient-to-r from-border to-transparent lg:block ${
                        isRTL ? "right-1/2" : "left-1/2"
                      }`}
                    />
                  )}
                  <div className="relative mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl border border-border bg-card">
                    <StepIcon className="size-7 text-primary" />
                    <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border/50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-12 text-center sm:p-16">
            {/* Background decoration */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
            </div>

            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t.ctaTitle}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
                {t.ctaDescription}
              </p>
              <Link
                href="/auth/sign-up"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90"
              >
                {t.ctaButton}
                <ArrowRight
                  className={`size-4 ${isRTL ? "rotate-180" : ""}`}
                />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                P
              </div>
              <span className="font-semibold">PermaMind</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.footerDescription}
            </p>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} PermaMind. {t.footerRights}
            </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border/50 pt-6 text-sm text-muted-foreground sm:justify-end">
              <a href="#privacy" className="transition-colors hover:text-foreground">{t.footerPrivacy}</a>
              <a href="#terms" className="transition-colors hover:text-foreground">{t.footerTerms}</a>
              <a href="#help" className="transition-colors hover:text-foreground">{t.footerHelp}</a>
              <a href="https://x.com/A_up100" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">{t.footerContact}</a>
            </div>

            <div className="grid gap-4 border-t border-border/50 pt-6 text-sm text-muted-foreground sm:grid-cols-3">
              <section id="privacy" className="scroll-mt-24">
                <h2 className="font-semibold text-foreground">{t.privacyTitle}</h2>
                <p className="mt-2 leading-relaxed">{t.privacyDescription}</p>
              </section>
              <section id="terms" className="scroll-mt-24">
                <h2 className="font-semibold text-foreground">{t.termsTitle}</h2>
                <p className="mt-2 leading-relaxed">{t.termsDescription}</p>
              </section>
              <section id="help" className="scroll-mt-24">
                <h2 className="font-semibold text-foreground">{t.helpTitle}</h2>
                <p className="mt-2 leading-relaxed">{t.helpDescription}</p>
              </section>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}