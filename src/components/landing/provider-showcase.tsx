import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { VaultFlow } from "@/components/landing/vault-flow";

type LogoBrand = {
  name: string;
  src: string;
  emphasis?: boolean;
};

/**
 * Display names for the providers in `AiProvider`
 * (src/lib/settings/api-key-storage.ts), so the rail advertises exactly what
 * Settings can actually connect to.
 */
const modelNames = [
  "OpenAI",
  "Claude",
  "Gemini",
  "DeepSeek",
  "Qwen",
  "Grok",
  "Kimi",
  "Llama",
  "Mistral",
  "Groq",
  "OpenRouter",
  "Meta",
  "Hugging Face",
  "NanoGPT",
  "Eden",
  "OrcaRouter",
  "Ollama",
];

/**
 * How much wider than the viewport the track has to be before a model can be
 * seen twice at once. Two full screens is the safe minimum; the rail then
 * always shows a partial list that wraps outside the visible window.
 */
const VIEWPORT_MULTIPLE = 2.2;
const MIN_SETS = 4;

const workBrands: LogoBrand[] = [
  { name: "Cursor", src: "/logos/cursor.svg" },
  { name: "Claude Code", src: "/logos/claude.code.svg" },
  { name: "Codex", src: "/logos/codex.svg" },
  { name: "Arweave", src: "/logos/arweave.svg", emphasis: true },
];

/**
 * The Arweave brand, named so callers stop reaching for a positional index.
 * `ProductStage` used `workBrands[3]`, which silently pointed at Arweave only as
 * long as nobody reordered the array above it.
 */
export const ARWEAVE_BRAND: LogoBrand = workBrands[3];

function BrandLogo({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="h-7 w-auto max-w-28 shrink-0 object-contain object-center"
    />
  );
}

function BrandChip({ brand }: { brand: LogoBrand }) {
  return (
    <span
      className={cn(
        "inline-flex h-12 shrink-0 items-center gap-2.5 rounded-full border px-4 text-sm font-semibold",
        brand.emphasis
          ? "border-primary/40 bg-primary/10 text-foreground shadow-sm shadow-primary/10"
          : "border-border/80 bg-card/80 text-foreground/80",
      )}
    >
      <BrandLogo src={brand.src} />
      {brand.name}
    </span>
  );
}

export function ProviderRail({ label }: { label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [sets, setSets] = useState(6);

  /**
   * The loop only hides a repeated name while the track is wider than the
   * window. A fixed repeat count is a guess that fails on ultrawide monitors
   * (the list fits on screen and both halves show at once), so the count is
   * derived from the measured width of one set.
   *
   * An even count is enforced because the seam sits at -50%: an odd number
   * would place the wrap in the middle of a set and jump by half a gap.
   */
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const measure = () => {
      const available = element.clientWidth;
      if (!available) return;
      const oneSet = element.scrollWidth / sets || available;
      const needed = Math.ceil((available * VIEWPORT_MULTIPLE) / oneSet);
      const even = Math.max(MIN_SETS, needed % 2 === 0 ? needed : needed + 1);
      if (even !== sets) setSets(even);
    };

    measure();
    // ResizeObserver is the precise tool here, but it is absent in older
    // browsers and in test environments; a window resize listener keeps the
    // rail correct either way.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sets]);

  const names = Array.from({ length: sets }, () => modelNames).flat();

  return (
    <div className="relative mt-8 sm:mt-12">
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:mb-5 sm:text-sm sm:tracking-[0.22em]">
        {label}
      </p>
      <div ref={viewport} className="logo-mask overflow-hidden" dir="ltr">
        <div
          className="logo-track flex w-max items-center"
          style={{ ["--marquee-gap" as string]: "0.5rem" }}
        >
          {names.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="mx-1.5 inline-flex h-11 shrink-0 items-center rounded-full border border-border/80 bg-card/80 px-4 text-sm font-semibold text-foreground/85 sm:mx-2 sm:h-14 sm:px-6 sm:text-base"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OwnershipMarks() {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-8">
      {workBrands.map((brand) => (
        <BrandChip key={brand.name} brand={brand} />
      ))}
    </div>
  );
}

type Stage = { label: string; value: string };

export function ProductStage({
  stages,
  question,
  answer,
  source,
  encrypted,
  cipher,
  permanent,
  rtl,
}: {
  stages: Stage[];
  question: string;
  answer: string;
  source: string;
  encrypted: string;
  cipher: string;
  permanent: string;
  rtl: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-card p-4 shadow-2xl shadow-primary/10 sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative grid gap-3 sm:grid-cols-3">
        {stages.map((stage, index) => (
          <div key={stage.label} className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{stage.label}</span>
              <span>0{index + 1}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-5">{stage.value}</p>
          </div>
        ))}
      </div>

      <div className="relative mt-4 rounded-2xl border border-border bg-background p-4">
        <p className="text-xs font-medium text-muted-foreground">{question}</p>
        <p className="mt-3 text-sm leading-7">{answer}</p>
        <p className="mt-3 text-xs text-muted-foreground">{source}</p>
      </div>

      <div className="relative mt-4">
        <VaultFlow
          stageEncrypted={encrypted}
          stageCipher={cipher}
          stagePermanent={permanent}
          rtl={rtl}
          variant="stage"
        />
      </div>
    </div>
  );
}
