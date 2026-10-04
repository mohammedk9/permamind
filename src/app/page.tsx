"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  Globe,
  Menu,
  Search,
  Shield,
  ArrowRight,
  ArrowDown,
  Sparkles,
  Users,
} from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SecurityStrip } from "@/components/landing/security-strip";
import { OwnershipMarks, ProductStage, ProviderRail } from "@/components/landing/provider-showcase";
import { SearchRail } from "@/components/landing/search-rail";
import { RoomsSection } from "@/components/landing/rooms-section";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/ui/logo";
import { SplashScreen } from "@/components/landing/splash-screen";
import { Locale, translations } from "@/lib/i18n/translations";

const featureIcons = {
  brain: Brain,
  search: Search,
  shield: Shield,
  globe: Globe,
  // The room feature. `Users` rather than another brain: this entry is about several people
  // in one encrypted conversation, and reusing the memory icon would make the card read as
  // a variation on the one above it.
  users: Users,
} as const;

/**
 * The section anchors live in one list so the desktop nav and the mobile sheet
 * can never drift apart. The labels reuse the headings already on the page.
 *
 * Typed off the shared shape rather than `typeof translations.en`: the bundle
 * is `as const`, so a parameter typed as the English entry alone would reject
 * the Arabic one on the very first property.
 */
function sectionAnchors(t: { howItWorksTitle: string; featuresTitle: string; searchTitle: string; securityTitle: string; roomsTitle: string }) {
  return [
    { href: "#how", label: t.howItWorksTitle },
    { href: "#features", label: t.featuresTitle },
    // Rooms sit after features in the reading order, so the anchor follows. Putting it last
    // here matches where the section actually lives rather than promoting it in the nav.
    { href: "#rooms", label: t.roomsTitle },
    { href: "#search", label: t.searchTitle },
    { href: "#security", label: t.securityTitle },
  ] as const;
}

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
         instantly instead of animating.

         `scroll-safe` reserves the iOS notch and the auto-hiding address bar so
         an anchored section heading never lands underneath either. */
      className="min-h-dvh scroll-smooth scroll-safe touch-manipulation overflow-y-auto overflow-x-clip bg-background text-foreground"
    >
      <SplashScreen />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {isRTL ? "تخطَّ إلى المحتوى" : "Skip to content"}
      </a>
      {/* Header. `pt` uses the safe-area inset so the bar clears the notch on
          a phone in standalone mode; the height stays 56px on small screens so
          the sticky bar does not eat a third of the viewport. */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] sm:h-16 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="PermaMind home">
            <Logo size="sm" withWordmark />
          </Link>
          {/* Section links, desktop only. The labels reuse the headings already on
              the page, so the nav can never disagree with what it points at. */}
          <nav
            aria-label={isRTL ? "أقسام الصفحة" : "Page sections"}
            className="hidden items-center gap-1 lg:flex"
          >
            {sectionAnchors(t).map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
          {/* Below `lg` the nav above is hidden, so the same anchors move into a
              sheet instead of becoming unreachable on a phone. */}
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={isRTL ? "فتح قائمة الأقسام" : "Open section menu"}
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side={isRTL ? "right" : "left"}
              className="w-[min(18rem,calc(100vw-2rem))] p-3"
            >
              <SheetTitle className="sr-only">
                {isRTL ? "أقسام الصفحة" : "Page sections"}
              </SheetTitle>
              <nav
                aria-label={isRTL ? "أقسام الصفحة" : "Page sections"}
                className="flex flex-col gap-1"
              >
                {sectionAnchors(t).map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            />
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
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:px-4"
            >
              {t.signUp}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero Section. Vertical rhythm is halved below `sm`: `pt-20 pb-24` (160px
            of padding) left the headline below the fold on a 640px-tall
            phone. The glow is capped in width so it cannot widen the page. */}
        <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[400px] w-[700px] max-w-[140vw] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl sm:h-[600px] sm:w-[900px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:px-4 sm:text-sm">
              <Sparkles className="size-4 shrink-0 text-primary" />
              <span className="truncate">{t.heroBadge}</span>
            </div>

            {/* Title */}
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {t.heroTitle}{" "}
              {/* The gradient span clips its own text; the closing line needs an
                  explicit colour or it inherits the transparent fill. */}
              <span className="bg-gradient-to-r from-primary via-primary/85 to-primary/60 bg-clip-text text-transparent rtl:bg-gradient-to-l">
                {t.heroTitleHighlight}
              </span>
              {t.heroTitleEnd ? (
                <span className="mt-2 block text-2xl text-foreground sm:text-4xl lg:text-5xl">
                  {t.heroTitleEnd}
                </span>
              ) : null}
            </h1>

            {/* Description */}
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
              {t.heroDescription}
            </p>

            {/* CTA Buttons. Full width on phones so both targets clear the 44px
                touch minimum instead of sitting as narrow pills side by side. */}
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center sm:gap-4">
              <Link
                href="/auth/sign-up"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto sm:px-8"
              >
                {t.heroCta}
                <ArrowRight
                  className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`}
                />
              </Link>
              <a
                href="#how"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3.5 text-base font-semibold text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:w-auto sm:px-8"
              >
                {t.heroSecondary}
                <ArrowDown className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`} />
              </a>
            </div>
            <p className="mx-auto mt-4 max-w-xl text-xs leading-6 text-muted-foreground sm:text-sm">
              {t.heroTrust}
            </p>
          </div>
          <ProviderRail label={t.providerRail} />
        </div>
      </section>

      {/* Product proof section. Every section below uses the same responsive
          padding scale: 64px on a phone, 96px from `sm` up. */}
      <section className="border-t border-border/50 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t.proofLabel}
            </p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-4xl">
              {t.compareTitle}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
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
      <section id="features" className="border-t border-border/50 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
              {t.featuresTitle}
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              {t.featuresDescription}
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:mt-16 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {t.features.map((feature) => {
              // `feature.icon` is a plain string in the translation bundle, so a
              // typo there would render `undefined` and crash the icon element.
              // Falling back keeps a copy mistake from taking down the section.
              const Icon = featureIcons[feature.icon as keyof typeof featureIcons] ?? Sparkles;
              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 sm:p-6"
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
            <div className="flex flex-col justify-between rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div>
                <h3 className="text-lg font-semibold">{t.ctaTitle}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t.ctaDescription}
                </p>
              </div>
              <Link
                href="/auth/sign-up"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-fit"
              >
                {t.ctaButton}
                <ArrowRight className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Rooms come after the feature grid and before MCP. The order is deliberate: rooms are
          the newest and most capable surface, so they sit where a returning reader meets them
          while still scrolling rather than buried at the end. */}
      <RoomsSection t={t} isRTL={isRTL} />

      {/* MCP integration section */}
      <section className="border-t border-border/50 py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary sm:text-sm">MCP · Cursor · Claude · Codex</p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-4xl">{t.mcpTitle}</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{t.mcpDescription}</p>
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
            <Link href="/auth/sign-up" className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto">
              {t.mcpCta}<ArrowRight className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`} />
            </Link>
          </div>
          <div className="rounded-3xl border border-primary/20 bg-card p-4 shadow-xl shadow-primary/5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">MCP</div>
              <div className="min-w-0">
                <p className="font-semibold">{t.mcpCardTitle}</p>
                <p className="text-sm text-muted-foreground">{t.mcpCardSubtitle}</p>
              </div>
            </div>
            <div className="mt-6 break-all rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground sm:text-sm">
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
      <section className="border-t border-border/50 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 text-center sm:p-12 lg:p-16">
            {/* Background decoration */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-1/2 h-[220px] w-[420px] max-w-[130vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl sm:h-[300px] sm:w-[600px]" />
            </div>

            <div className="relative">
              <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
                {t.ctaTitle}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
                {t.ctaDescription}
              </p>
              <Link
                href="/auth/sign-up"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 sm:w-auto sm:px-8"
              >
                {t.ctaButton}
                <ArrowRight
                  className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`}
                />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-card/20">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-20">
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

          <div className="mt-10 flex flex-col gap-2 border-t border-border/60 pt-6 text-sm text-muted-foreground pb-[env(safe-area-inset-bottom)] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pb-0">
            <p>© {new Date().getFullYear()} PermaMind. {t.footerRights}</p>
            <p>{t.footerDescription}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}