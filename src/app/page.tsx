"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  Globe,
  Search,
  Shield,
  ArrowRight,
  ArrowDown,
  Sparkles,
} from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SecurityStrip } from "@/components/landing/security-strip";
import { OwnershipMarks, ProductStage, ProviderRail } from "@/components/landing/provider-showcase";
import { SearchRail } from "@/components/landing/search-rail";
import { Logo } from "@/components/ui/logo";
import { SplashScreen } from "@/components/landing/splash-screen";
import { Locale, translations } from "@/lib/i18n/translations";

const featureIcons = {
  brain: Brain,
  search: Search,
  shield: Shield,
  globe: Globe,
} as const;

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
      id="top"
      dir={isRTL ? "rtl" : "ltr"}
      /* This element is the scroll container: `html` and `body` are both
         `overflow: hidden` (see globals.css), so `scroll-behavior: smooth` on
         `html` never applies to it. Without this, the header anchors jump
         instantly instead of animating. */
      className="min-h-dvh scroll-smooth overflow-y-auto bg-background text-foreground"
    >
      <SplashScreen />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {isRTL ? "تخطَّ إلى المحتوى" : "Skip to content"}
      </a>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="PermaMind home">
            <Logo size="sm" withWordmark />
          </Link>
          {/* Section links, desktop only. The labels reuse the headings already on
              the page, so the nav can never disagree with what it points at. */}
          <nav
            aria-label={isRTL ? "أقسام الصفحة" : "Page sections"}
            className="hidden items-center gap-1 lg:flex"
          >
            {[
              { href: "#how", label: t.howItWorksTitle },
              { href: "#features", label: t.featuresTitle },
              { href: "#search", label: t.searchTitle },
              { href: "#security", label: t.securityTitle },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
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

      <main id="main">
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
            <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              {t.heroTitle}{" "}
              {/* The gradient span clips its own text; the closing line needs an
                  explicit colour or it inherits the transparent fill. */}
              <span className="bg-gradient-to-r from-primary via-primary/85 to-primary/60 bg-clip-text text-transparent rtl:bg-gradient-to-l">
                {t.heroTitleHighlight}
              </span>
              {t.heroTitleEnd ? (
                <span className="mt-2 block text-3xl text-foreground sm:text-5xl">
                  {t.heroTitleEnd}
                </span>
              ) : null}
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
                href="#how"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:w-auto"
              >
                {t.heroSecondary}
                <ArrowDown className={`size-4 ${isRTL ? "rotate-180" : ""}`} />
              </a>
            </div>
            <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground">
              {t.heroTrust}
            </p>
          </div>
          <ProviderRail label={t.providerRail} />
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
              {t.compareTitle}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t.compareDescription}
            </p>
            <div className="mt-6 grid gap-3">
              {t.compare.map((item) => (
                <div key={item.title} className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
            <OwnershipMarks />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {t.trustItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <ProductStage
            stages={[
              { label: t.stageModel, value: t.stageModelValue },
              { label: t.stageMemory, value: t.stageMemoryValue },
              { label: t.stageVault, value: t.stageVaultValue },
            ]}
            question={t.proofQuestion}
            answer={t.proofAnswer}
            source={t.proofSource}
            encrypted={t.stageEncrypted}
            cipher={t.stageCipher}
            permanent={t.stagePermanent}
            rtl={isRTL}
          />
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

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.features.map((feature) => {
              // `feature.icon` is a plain string in the translation bundle, so a
              // typo there would render `undefined` and crash the icon element.
              // Falling back keeps a copy mistake from taking down the section.
              const Icon = featureIcons[feature.icon as keyof typeof featureIcons] ?? Sparkles;
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
            {/* Sixth cell, so the three-column grid ends in a full row. With five
                features the last row held one lonely card; this fills it with the
                call to action instead of padding the grid with a blank space. */}
            <div className="flex flex-col justify-between rounded-2xl border border-primary/30 bg-primary/5 p-6">
              <div>
                <h3 className="text-lg font-semibold">{t.ctaTitle}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t.ctaDescription}
                </p>
              </div>
              <Link
                href="/auth/sign-up"
                className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t.ctaButton}
                <ArrowRight className={`size-4 ${isRTL ? "rotate-180" : ""}`} />
              </Link>
            </div>
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
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
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
              <div>
                <p className="font-semibold">{t.mcpCardTitle}</p>
                <p className="text-sm text-muted-foreground">{t.mcpCardSubtitle}</p>
              </div>
            </div>
            <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              {t.mcpCardEndpoint}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t.mcpCardConnect}</p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <HowItWorks copy={t} rtl={isRTL} />

      {/* Web search providers */}
      <SearchRail copy={t} />

      {/* Security strip */}
      <SecurityStrip copy={t} />

      </main>

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
      <footer className="border-t border-border/60 bg-card/20">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-20">
            <div>
              <Link
                href="/"
                className="inline-flex rounded-lg"
                aria-label="PermaMind home"
              >
                <Logo size="xs" withWordmark />
              </Link>
              <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">
                {t.footerDescription}
              </p>
              <a
                href="https://x.com/A_up100"
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {t.footerContact}
              </a>
            </div>

            <nav aria-label="Footer navigation">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {isRTL ? "روابط" : "Explore"}
              </p>
              <div className="mt-5 flex flex-col gap-4 text-sm">
                <Link href="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">
                  {t.footerPrivacy}
                </Link>
                <Link href="/terms" className="text-muted-foreground transition-colors hover:text-foreground">
                  {t.footerTerms}
                </Link>
                <a href="#top" className="text-muted-foreground transition-colors hover:text-foreground">
                  {isRTL ? "العودة للأعلى" : "Back to top"}
                </a>
              </div>
            </nav>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} PermaMind. {t.footerRights}</p>
            <p>{t.footerDescription}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}