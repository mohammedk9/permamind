/**
 * Turning a finished room into something the host keeps.
 *
 * ## What leaves the room, and what does not
 *
 * The design's section 9 sets the boundary: an approved decision is the one thing that may
 * cross out of the room, and only by an explicit act of the host. This module is that act,
 * written down rather than remembered.
 *
 * **Nothing here writes to the memory ledger.** That was decided deliberately. The ledger is
 * the host's permanent record, and a room is a temporary shared space; a brainstorm that
 * silently became permanent memory is how a memory system fills with noise. What leaves is a
 * *file* — something the host chose to make, can read, can delete, and can throw away. A file
 * is a far smaller promise than a ledger entry, and it is the one a room can honestly make.
 *
 * ## Why the report is assembled here and not on the server
 *
 * The server holds ciphertext. Everything in this report is plaintext that only a browser
 * with the room key can read, so the report is built in the browser from data the client has
 * already decrypted. Nothing is sent anywhere to produce it.
 */

// The copy, in both languages the room is used in.
//
// Kept as a flat map rather than a nested object because it is rendered into a template by
// `renderRoomReport`, and a flat map keeps the substitution in that function a single loop
// rather than a recursive walk over a shape nobody can type-check at a glance.
const COPY = {
  title: { en: "Room report", ar: "تقرير الغرفة" },
  exported: { en: "Exported", ar: "نصدر في" },
  ideas: { en: "Ideas", ar: "الأفكار" },
  accepted: { en: "Accepted", ar: "مقبولة" },
  dropped: { en: "Dropped", ar: "مستبعدة" },
  open: { en: "Still open", ar: "ما زالت مفتوحة" },
  noIdeas: { en: "No ideas were added to this room.", ar: "لم تضف أي فكرة إلى هذه الغرفة." },
  score: { en: "Score", ar: "النتيجة" },
  votes: { en: "vote", ar: "صوت" },
  votesPlural: { en: "votes", ar: "أصوات" },
  summary: { en: "Summary", ar: "الخلاصة" },
  noSummary: {
    en: "No summary was written for this room.",
    ar: "لم تكتب خلاصة لهذه الغرفة.",
  },
  members: { en: "Contributors", ar: "المشاركون" },
  duration: { en: "Room lifetime", ar: "مدة الغرفة" },
  hours: { en: "hours", ar: "ساعة" },
  decisions: { en: "Decisions", ar: "القرارات" },
  noDecisions: {
    en: "No idea was accepted, so this room produced no decision.",
    ar: "لم تقبل أي فكرة فلم تخرج هذه الغرفة قرارا.",
  },
  footer: {
    en: "This report was exported from a temporary room. Everything else in it was deleted when the room closed.",
    ar: "صدر هذا التقرير من غرفة مؤقتة. حذف كل ما عدا هذا منها عند إغلاق الغرفة.",
  },
} as const;

/** The two languages a room report is written in. */
export type ReportLocale = "en" | "ar";

export interface ReportIdea {
  text: string;
  score: number;
  voters: number;
  status: "open" | "accepted" | "dropped";
}

export interface RoomReportInput {
  roomId: string;
  /** The host's own summary of what was decided. Never the transcript. */
  summary: string;
  ideas: ReportIdea[];
  /** Distinct display names, already decrypted. Never more than what the room showed. */
  contributorLabels: string[];
  hoursOpen: number;
  createdAt: string;
  locale: ReportLocale;
}

export interface RoomReport {
  title: string;
  exportedAt: string;
  roomId: string;
  hoursOpen: number;
  contributors: string[];
  summary: string;
  ideas: ReportIdea[];
  accepted: ReportIdea[];
  dropped: ReportIdea[];
  open: ReportIdea[];
  /** The closing line. Present in every report, and the reason the report is honest. */
  footer: string;
}

/**
 * Builds the report.
 *
 * Accepted ideas come first and carry the section of their own, because the accepted list is
 * what someone opening this file in six months is actually looking for. Dropped ideas are
 * kept rather than discarded: a decision that was rejected is evidence of what was
 * considered, and a report that shows only what won reads as though nothing else was ever on
 * the table.
 */
export function buildRoomReport(input: RoomReportInput): RoomReport {
  const locale = input.locale === "ar" ? "ar" : "en";
  const t = (key: keyof typeof COPY) => COPY[key][locale];

  const ideas = input.ideas.map((idea) => ({
    ...idea,
    text: idea.text.trim(),
  }));

  return {
    title: t("title"),
    exportedAt: new Date().toISOString(),
    roomId: input.roomId,
    hoursOpen: Math.max(0, Math.round(input.hoursOpen)),
    contributors: [...new Set(input.contributorLabels.filter(Boolean))],
    summary: input.summary.trim(),
    ideas,
    accepted: ideas.filter((idea) => idea.status === "accepted"),
    dropped: ideas.filter((idea) => idea.status === "dropped"),
    open: ideas.filter((idea) => idea.status === "open"),
    footer: t("footer"),
  };
}

/**
 * Escapes text for interpolation into HTML.
 *
 * Every string in a report came from something a member typed, and a report is a file the
 * host will open later — possibly in a viewer that renders HTML. An unescaped idea would be a
 * script running in that viewer, from a room member who never intended to write one.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the report as a self-contained HTML document.
 *
 * ## Why HTML and not a PDF library
 *
 * Arabic needs **contextual letter shaping**: the four forms of each letter, joined to their
 * neighbours, laid out right to left. Browser engines do this as part of rendering text. A
 * PDF library has to do it separately, from a font file, with a shaper, for both scripts — and
 * the versions that get this wrong produce a page of disconnected, left-to-right letters.
 *
 * So this renders a document and lets the **print dialogue** produce the PDF. The browser is
 * the best Arabic typesetter available on the machine, it is already there, and the output is a
 * real PDF with selectable, correctly-shaped Arabic in it. The alternative would be a
 * dependency, a font, a shaper, and a page of broken Arabic for anyone who noticed.
 *
 * `direction` and `text-align` follow the locale, because an Arabic report that lays out
 * left-to-right reads as a different document, not a translated one.
 */
export function renderRoomReportHtml(report: RoomReport, locale: ReportLocale): string {
  const ar = locale === "ar";
  const dir = ar ? "rtl" : "ltr";
  const t = (key: keyof typeof COPY) => COPY[key][ar ? "ar" : "en"];

  const ideaRow = (idea: ReportIdea) => {
    const votes = `${idea.voters} ${idea.voters === 1 ? t("votes") : t("votesPlural")}`;
    return `<li class="idea">
      <p class="idea-text">${escapeHtml(idea.text)}</p>
      <p class="idea-meta"><span class="score">${idea.score}</span> ${t("score")} · ${escapeHtml(votes)}</p>
    </li>`;
  };

  const section = (heading: string, items: ReportIdea[], empty: string) =>
    items.length === 0
      ? ""
      : `<section class="block">
          <h2>${escapeHtml(heading)}</h2>
          <ul class="ideas">${items.map(ideaRow).join("")}</ul>
        </section>`;

  const created = new Date(report.exportedAt);

  return `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)} — ${escapeHtml(report.roomId)}</title>
<style>
  /* A system font stack rather than a webfont: the report has to render offline, from a
     file the host may open months from now, with no network. Whatever the reader has is
     what shapes their Arabic. */
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", "Arial", sans-serif;
    line-height: 1.7;
    max-width: 44rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
    color: #111;
    background: #fff;
  }
  header { border-bottom: 2px solid #111; padding-bottom: 1rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  .meta { font-size: .8rem; color: #555; margin: 0; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .75rem; padding-bottom: .3rem; border-bottom: 1px solid #ddd; }
  ul.ideas { list-style: none; margin: 0; padding: 0; }
  li.idea { padding: .7rem 0; border-bottom: 1px solid #eee; break-inside: avoid; }
  .idea-text { margin: 0 0 .25rem; }
  .idea-meta { margin: 0; font-size: .78rem; color: #666; }
  .score { font-weight: 700; color: #111; }
  .summary { white-space: pre-wrap; background: #f7f7f8; padding: 1rem; border-radius: .4rem; border: 1px solid #e5e5e7; }
  .empty { color: #777; font-style: italic; }
  .chips { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; list-style: none; }
  .chips li { font-size: .8rem; background: #f0f0f2; padding: .2rem .6rem; border-radius: 1rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd; font-size: .78rem; color: #666; }

  /* Printed output drops the screen furniture and starts every block on a fresh page only
     where a block would otherwise be split across one. Page breaks mid-idea are the single
     most common way an exported PDF looks broken. */
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    h2 { break-after: avoid; }
    li.idea { break-inside: avoid; }
    footer { break-inside: avoid; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">
    ${escapeHtml(t("exported"))} ${escapeHtml(created.toLocaleString(ar ? "ar" : "en-US"))}
    · ${escapeHtml(t("duration"))}: ${report.hoursOpen} ${escapeHtml(t("hours"))}
  </p>
</header>

<section class="block">
  <h2>${escapeHtml(t("summary"))}</h2>
  <div class="summary">${escapeHtml(report.summary || t("noSummary"))}</div>
</section>

${
  report.contributors.length > 0
    ? `<section class="block">
  <h2>${escapeHtml(t("members"))}</h2>
  <ul class="chips">${report.contributors.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
</section>`
    : ""
}

${
  report.accepted.length > 0
    ? section(t("decisions"), report.accepted, t("noDecisions"))
    : `<section class="block">
  <h2>${escapeHtml(t("decisions"))}</h2>
  <p class="empty">${escapeHtml(t("noDecisions"))}</p>
</section>`
}

${report.ideas.length === 0 ? "" : section(t("ideas"), report.ideas, t("noIdeas"))}

<footer>${escapeHtml(report.footer)}</footer>
</body>
</html>`;
}