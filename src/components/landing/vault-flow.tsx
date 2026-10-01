import React from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { ARWEAVE_BRAND } from "@/components/landing/provider-showcase";

/** The one line of copy each side of the vault flow needs, in both locales. */
export type VaultFlowCopy = {
  stageEncrypted: string;
  stageCipher: string;
  stagePermanent: string;
};

export type VaultFlowProps = VaultFlowCopy & {
  /** Flip the arrow to follow reading direction. */
  rtl: boolean;
  /**
   * `panel` is the preview inside "How it works"; `stage` is the compact strip in
   * the product proof card. Only spacing differs, so both share one structure.
   */
  variant?: "panel" | "stage";
  /** Animates the arrow to imply movement. Off inside the compact stage. */
  animated?: boolean;
};

/**
 * Encrypted here, permanent there.
 *
 * This block appeared twice on the page — once in `ProductStage` and once in the
 * fourth step preview of `HowItWorks` — and the two copies had already drifted in
 * padding and border colour. It is extracted so the claim PermaMind makes about
 * Arweave can only be written once.
 */
export function VaultFlow({
  stageEncrypted,
  stageCipher,
  stagePermanent,
  rtl,
  variant = "panel",
  animated = false,
}: VaultFlowProps) {
  const panel = variant === "panel";

  return (
    <div
      className={cn(
        "grid items-center gap-3",
        panel && "sm:grid-cols-[1fr_auto_1fr]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-border bg-background",
          panel ? "px-4 py-4" : "p-3",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold tracking-wide">
          AES
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{stageEncrypted}</p>
          <p className="text-xs text-muted-foreground">{stageCipher}</p>
        </div>
      </div>

      <span
        aria-hidden="true"
        className={cn(
          "justify-self-center text-primary",
          // The strip hides the arrow on narrow screens rather than letting it
          // collapse the two columns into an unreadable stack.
          !panel && "hidden sm:block",
          animated && "how-arrow-pulse",
          rtl && "rotate-180",
        )}
      >
        <ArrowRight className={panel ? "size-5" : "text-xl"} />
      </span>

      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10",
          panel ? "px-4 py-4" : "p-3",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background">
          <img
            src={ARWEAVE_BRAND.src}
            alt=""
            draggable={false}
            className={cn(
              "h-6 w-auto object-contain",
              // The compact strip keeps the logo inside a badge-sized square so it
              // does not stretch the row next to the descriptive text.
              !panel && "max-w-8",
            )}
          />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Arweave</p>
          <p className="text-xs text-muted-foreground">{stagePermanent}</p>
        </div>
      </div>
    </div>
  );
}
