import type { ComponentType } from "react";
import {
  ArweaveMark,
  ClaudeMark,
  CodexMark,
  CursorMark,
  DeepSeekMark,
  GeminiMark,
  GrokMark,
  GroqMark,
  KimiMark,
  MetaMark,
  OpenAIMark,
  OpenRouterMark,
  QwenMark,
} from "@/components/landing/brand-marks";

type Brand = {
  name: string;
  Mark: ComponentType<{ className?: string }>;
  emphasis?: boolean;
};

const modelBrands: Brand[] = [
  { name: "OpenAI", Mark: OpenAIMark },
  { name: "Claude", Mark: ClaudeMark },
  { name: "Gemini", Mark: GeminiMark },
  { name: "DeepSeek", Mark: DeepSeekMark },
  { name: "Qwen", Mark: QwenMark },
  { name: "Grok", Mark: GrokMark },
  { name: "Kimi", Mark: KimiMark },
  { name: "Meta", Mark: MetaMark },
  { name: "Groq", Mark: GroqMark },
  { name: "OpenRouter", Mark: OpenRouterMark },
];

const workBrands: Brand[] = [
  { name: "Cursor", Mark: CursorMark },
  { name: "Claude", Mark: ClaudeMark },
  { name: "Codex", Mark: CodexMark },
  { name: "Arweave", Mark: ArweaveMark, emphasis: true },
];

function BrandChip({ brand }: { brand: Brand }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-semibold ${
        brand.emphasis
          ? "border-primary/40 bg-primary/10 text-foreground shadow-sm shadow-primary/10"
          : "border-border/80 bg-card/80 text-foreground/80"
      }`}
    >
      <brand.Mark className={`size-5 ${brand.emphasis ? "text-primary" : ""}`} />
      {brand.name}
    </span>
  );
}

export function ProviderRail({ label }: { label: string }) {
  const brands = [...modelBrands, ...modelBrands];
  return (
    <div className="relative mt-12">
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <div className="logo-mask overflow-hidden">
        <div className="logo-track flex w-max gap-3 py-1">
          {brands.map((brand, index) => (
            <BrandChip key={`${brand.name}-${index}`} brand={brand} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function OwnershipMarks() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2">
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

      <div className="relative mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <OpenAIMark className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{encrypted}</p>
            <p className="text-xs text-muted-foreground">{cipher}</p>
          </div>
        </div>
        <span className={`hidden text-xl text-primary sm:block ${rtl ? "rotate-180" : ""}`} aria-hidden="true">
          →
        </span>
        <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-background text-primary">
            <ArweaveMark className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold">Arweave</p>
            <p className="text-xs text-muted-foreground">{permanent}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
