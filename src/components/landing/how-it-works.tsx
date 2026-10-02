"use client";

import React, { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  History,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VaultFlow } from "@/components/landing/vault-flow";

/** The subset of the translation bundle this section needs. */
export type HowItWorksCopy = {
  howEyebrow: string;
  howItWorksTitle: string;
  howItWorksDescription: string;
  howPreviewHint: string;
  // `translations` is declared `as const`, so these arrive as readonly tuples.
  steps: readonly { readonly title: string; readonly description: string }[];
  howPreview: {
    chatUser: string;
    chatAssistant: string;
    chatNote: string;
    extractTitle: string;
    extractNote: string;
    extractItems: readonly string[];
    recallLabel: string;
    vaultNote: string;
  };
  proofQuestion: string;
  proofAnswer: string;
  proofSource: string;
  stageEncrypted: string;
  stageCipher: string;
  stagePermanent: string;
};

const STEP_ICONS = [MessageSquare, Sparkles, History, Lock] as const;

/** Shared shell for every preview so the panel never changes size between steps. */
function PreviewFrame({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof MessageSquare;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-4 shadow-2xl shadow-primary/10 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {children}
    </div>
  );
}

/** Step 1 â€” an ordinary conversation, with nothing leaving the device. */
function ChatPreview({ copy }: { copy: HowItWorksCopy }) {
  return (
    <PreviewFrame label={copy.steps[0].title} icon={MessageSquare}>
      <div className="flex flex-1 flex-col gap-3">
        <div className="max-w-[85%] self-start rounded-2xl rounded-ss-md border border-border bg-background px-4 py-3 text-sm leading-6">
          {copy.howPreview.chatUser}
        </div>
        <div className="flex max-w-[85%] items-center gap-1 self-end rounded-2xl rounded-se-md bg-primary/15 px-4 py-3 text-sm leading-6">
          {copy.howPreview.chatAssistant}
        </div>
        <div className="mt-auto flex items-center gap-1.5 pt-2" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70"
              style={{ animationDelay: `${dot * 160}ms` }}
            />
          ))}
        </div>
      </div>
      <p className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        {copy.howPreview.chatNote}
      </p>
    </PreviewFrame>
  );
}

/** Step 2 â€” the important details lifted out of the conversation. */
function ExtractPreview({ copy }: { copy: HowItWorksCopy }) {
  return (
    <PreviewFrame label={copy.steps[1].title} icon={Sparkles}>
      <p className="text-sm font-semibold">{copy.howPreview.extractTitle}</p>
      <ul className="mt-4 space-y-2.5">
        {copy.howPreview.extractItems.map((item, index) => (
          <li
            key={item}
            className="how-item-enter flex items-start gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm leading-6"
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Check className="size-3" />
            </span>
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-auto flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <Lock className="size-4 shrink-0 text-primary" />
        {copy.howPreview.extractNote}
      </p>
    </PreviewFrame>
  );
}

/** Step 3 â€” the next conversation opens with yesterday's context already in it. */
function RecallPreview({ copy }: { copy: HowItWorksCopy }) {
  return (
    <PreviewFrame label={copy.steps[2].title} icon={History}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
        <ArrowDown className="size-4" />
        {copy.howPreview.recallLabel}
      </div>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">{copy.proofQuestion}</p>
        <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm leading-7">
          {copy.proofAnswer}
        </div>
        <p className="text-xs text-muted-foreground">{copy.proofSource}</p>
      </div>
    </PreviewFrame>
  );
}

/** Step 4 â€” encrypted locally first, then permanent on Arweave. */
function VaultPreview({ copy, rtl }: { copy: HowItWorksCopy; rtl: boolean }) {
  return (
    <PreviewFrame label={copy.steps[3].title} icon={Lock}>
      <VaultFlow
        stageEncrypted={copy.stageEncrypted}
        stageCipher={copy.stageCipher}
        stagePermanent={copy.stagePermanent}
        rtl={rtl}
        variant="panel"
        animated
      />
      <p className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        {copy.howPreview.vaultNote}
      </p>
    </PreviewFrame>
  );
}


/**
 * "How it works" â€” an interactive four-step explainer.
 *
 * The steps behave as a tab list: clicking one, or arrowing through them with
 * the keyboard, swaps the live preview beside them. The section inherits the
 * page's `dir`, so the only piece needing explicit direction handling is the
 * arrow inside the Arweave preview.
 */
export function HowItWorks({ copy, rtl }: { copy: HowItWorksCopy; rtl: boolean }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = copy.steps.length - 1;

  function move(next: number) {
    setActive(next);
    tabs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Arrow keys follow reading order, so forward/backward flip in RTL.
    const forward = rtl ? ["ArrowLeft", "ArrowDown"] : ["ArrowRight", "ArrowDown"];
    const backward = rtl ? ["ArrowRight", "ArrowUp"] : ["ArrowLeft", "ArrowUp"];
    if (forward.includes(event.key)) {
      event.preventDefault();
      move((index + 1) % copy.steps.length);
    } else if (backward.includes(event.key)) {
      event.preventDefault();
      // Wrap around using the step count, so index 0 steps back to the last one.
      move((index - 1 + copy.steps.length) % copy.steps.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(last);
    }
  }

  return (
    <section id="how" className="relative scroll-mt-20 overflow-hidden border-t border-border/50 py-16 sm:py-24">
      {/* `overflow-hidden` on the section is what keeps this glow — 560px wide,
          centred — from forcing a horizontal scrollbar on a phone. The glow is
          also capped in width so it degrades gracefully on small screens. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 size-[360px] max-w-[120vw] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl sm:size-[560px]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            {copy.howEyebrow}
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-4xl">
            {copy.howItWorksTitle}
          </h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">{copy.howItWorksDescription}</p>
        </div>

        <div className="mt-10 grid gap-8 sm:mt-14 sm:gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
          <div
            role="tablist"
            aria-label={copy.howItWorksTitle}
            aria-orientation="vertical"
            className="relative flex flex-col gap-3"
          >
            {/* Progress rail, centred on the 44px step badges (22px + 1px). */}
            <span
              aria-hidden="true"
              className="absolute bottom-7 top-7 hidden w-px bg-border lg:ltr:left-[22px] lg:rtl:right-[22px] lg:block"
            />
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-7 hidden w-px bg-gradient-to-b from-primary to-primary/20 transition-[height] duration-500 ease-out",
                "lg:ltr:left-[22px] lg:rtl:right-[22px] lg:block",
              )}
              style={{ height: `calc((100% - 3.5rem) * ${active / last})` }}
            />

            {copy.steps.map((step, index) => {
              const isActive = index === active;
              const Icon = STEP_ICONS[index];
              return (
                <button
                  key={step.title}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  role="tab"
                  type="button"
                  id={`how-tab-${index}`}
                  aria-selected={isActive}
                  aria-controls="how-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className={cn(
                    // Tighter padding and a smaller badge below `sm`: at the
                    // original size the 44px icon plus 32px padding left almost
                    // no room for the step title on a 360px screen.
                    "relative flex items-start gap-3 rounded-2xl border p-3 text-start transition-all duration-300 sm:gap-4 sm:p-4",
                    isActive
                      ? "border-primary/40 bg-primary/10 shadow-lg shadow-primary/10"
                      : "border-border bg-card/40 hover:bg-card/80",
                  )}
                >
                  <span
                    className={cn(
                      "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-300 sm:size-11",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4 sm:size-5" />
                  </span>
                  <span className="min-w-0 pt-0.5 sm:pt-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          "text-[11px] font-semibold tracking-[0.14em]",
                          isActive ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        0{index + 1}
                      </span>
                      <span className="min-w-0 text-sm font-semibold sm:text-base">{step.title}</span>
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </span>
                  </span>
                </button>
              );
            })}

            <p className="text-xs text-muted-foreground lg:hidden">{copy.howPreviewHint}</p>
          </div>

          <div
            role="tabpanel"
            id="how-panel"
            aria-labelledby={`how-tab-${active}`}
            tabIndex={0}
            className="how-panel-enter rounded-3xl outline-none"
          >
            {active === 0 && <ChatPreview copy={copy} />}
            {active === 1 && <ExtractPreview copy={copy} />}
            {active === 2 && <RecallPreview copy={copy} />}
            {active === 3 && <VaultPreview copy={copy} rtl={rtl} />}
          </div>
        </div>
      </div>
    </section>
  );
}
