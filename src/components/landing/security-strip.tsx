import React from "react";
import { CloudUpload, ShieldCheck, Zap } from "lucide-react";
import {
  ENCRYPTION_ALGORITHM,
  FREE_STORAGE_QUOTA_MB,
  KDF_ALGORITHM,
  KDF_ITERATIONS,
  MAX_UPLOAD_SIZE_MB,
} from "@/lib/arweave/constants";

/** The one line of copy this section needs, in both locales. */
export type SecurityStripCopy = {
  securityTitle: string;
  securityCipher: string;
  securityKdf: string;
  storageNote: (freeMb: string) => string;
};

/**
 * Three hard numbers instead of a paragraph of reassurance.
 *
 * Every value is imported from `lib/arweave/constants`, so the strip can never
 * drift from the limits the app actually enforces: change a constant and the
 * landing page follows automatically.
 */
export function SecurityStrip({ copy }: { copy: SecurityStripCopy }) {
  const cards = [
    {
      Icon: ShieldCheck,
      value: ENCRYPTION_ALGORITHM,
      label: copy.securityCipher,
    },
    {
      Icon: Zap,
      // 310_000 -> "310K": the exact count belongs in the constants, not here.
      value: `${Math.round(KDF_ITERATIONS / 1000)}K`,
      label: `${KDF_ALGORITHM} ${copy.securityKdf.toLowerCase()}`,
    },
    {
      Icon: CloudUpload,
      value: `${MAX_UPLOAD_SIZE_MB} MB`,
      label: copy.storageNote(`${FREE_STORAGE_QUOTA_MB} MB`),
    },
  ];

  return (
    <section id="security" className="scroll-mt-20 border-t border-border/50 py-16 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {copy.securityTitle}
        </p>

        {/* One column on small screens; the numbers stay legible instead of
            being squeezed into three narrow cards. */}
        <dl className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-3">
          {cards.map(({ Icon, value, label }) => (
            <div
              key={value}
              className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card/50 px-4 py-6 text-center sm:px-5 sm:py-7"
            >
              <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <dd className="text-xl font-bold tracking-tight text-primary sm:text-3xl">
                {value}
              </dd>
              <dt className="text-xs leading-6 text-muted-foreground sm:text-sm">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}