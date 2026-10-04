"use client";

import Link from "next/link";
import {
  ArrowRight,
  Coins,
  FileText,
  KeyRound,
  MessageSquare,
  Scale,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";

/**
 * The rooms section.
 *
 * ## Why the two room kinds sit side by side
 *
 * They are drawn as two cards rather than one blended feature because the difference is the whole
 * point: who is allowed to spend a key, and whose it is. Putting them in separate columns lets a
 * reader find "who pays" in one glance, which is the first question anyone asks about a shared AI
 * conversation and the one a screenshot never answers.
 *
 * ## The claims here are exact
 *
 * Every sentence describes behaviour that is actually implemented, and each one is worded to avoid
 * an overclaim. Nothing says a message "cannot be read by anyone" — it says the *server* cannot
 * read it, because a participant with the room key obviously can. The distinction is the product.
 */

type Copy = {
  roomsTitle: string;
  roomsDescription: string;
  roomsBadge: string;
  roomsGuestTitle: string;
  roomsGuestBody: string;
  roomsPanelTitle: string;
  roomsPanelBody: string;
  roomsControlTitle: string;
  roomsControlBody: string;
  roomsFilesTitle: string;
  roomsFilesBody: string;
  roomsReportTitle: string;
  roomsReportBody: string;
  roomsCta: string;
  roomsCostLabel: string;
  roomsCostGuest: string;
  roomsCostPanel: string;
};

export function RoomsSection({ t, isRTL }: { t: Copy; isRTL: boolean }) {
  return (
    <section id="rooms" className="border-t border-border/50 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {t.roomsBadge}
          </span>
          <h2 className="mt-5 text-2xl font-bold tracking-tight sm:text-4xl">{t.roomsTitle}</h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">{t.roomsDescription}</p>
        </div>

        {/* The two room kinds. Deliberately equal in size: neither is the "real" rooms feature
            and the other a variant. A guest room that hosts a panel conversation is the more
            common case, and shrinking it would read as lesser. */}
        <div className="mt-10 grid gap-5 sm:mt-14 lg:grid-cols-2">
          <RoomCard
            icon={MessageSquare}
            title={t.roomsGuestTitle}
            body={t.roomsGuestBody}
            cost={t.roomsCostGuest}
            costLabel={t.roomsCostLabel}
            points={[
              { icon: KeyRound, text: t.roomsBadge },
              { icon: Users, text: t.roomsControlTitle },
            ]}
          />
          <RoomCard
            icon={Vote}
            title={t.roomsPanelTitle}
            body={t.roomsPanelBody}
            cost={t.roomsCostPanel}
            costLabel={t.roomsCostLabel}
            accent
            points={[
              { icon: Coins, text: t.roomsControlTitle },
              { icon: Users, text: t.roomsPanelBody },
            ]}
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <DetailCard icon={Scale} title={t.roomsControlTitle} body={t.roomsControlBody} />
          <DetailCard icon={FileText} title={t.roomsFilesTitle} body={t.roomsFilesBody} />
          <DetailCard icon={ShieldCheck} title={t.roomsReportTitle} body={t.roomsReportBody} />
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/rooms/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02]"
          >
            {t.roomsCta}
            <ArrowRight className={`size-4 shrink-0 ${isRTL ? "rotate-180" : ""}`} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function RoomCard({ icon: Icon, title, body, cost, costLabel, points, accent = false }: { icon: typeof Users; title: string; body: string; cost: string; costLabel: string; points: { icon: typeof Users; text: string }[]; accent?: boolean }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-6 transition-colors ${accent ? "border-primary/35 bg-primary/[0.04]" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <ul className="mt-5 space-y-2">
        {points.map(({ icon: PointIcon, text }) => (
          <li key={text} className="flex items-start gap-2 text-sm text-muted-foreground">
            <PointIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {/* The cost line sits apart, in its own row, because "who pays" is a different kind of
          fact from the description above it — it is a commitment, not a feature. */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">{costLabel}</span>
        <span className="text-sm font-semibold text-primary">{cost}</span>
      </div>
    </div>
  );
}

function DetailCard({ icon: Icon, title, body }: { icon: typeof Users; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}