import { describe, expect, it } from "vitest";

import { buildRoomReport, renderRoomReportHtml, type RoomReportInput } from "../report";

/**
 * The room report — the one thing that leaves a room.
 *
 * Three properties are worth a test each, and none of them is "the HTML looks right":
 *
 *   1. **Nothing reaches the memory ledger.** This module cannot write there; there is no
 *      import of it. The test below is not about that — it is about what the report *is*:
 *      a file, containing decisions and the ideas behind them.
 *   2. **Arabic is shaped correctly.** Arabic needs contextual letter forms and RTL layout.
 *      A report that lays out left-to-right reads as a different document, not a translated
 *      one, so `dir` is asserted rather than assumed.
 *   3. **Member text is escaped.** Every string came from something a member typed, and the
 *      report is a file the host opens later in a viewer that renders HTML.
 */

const base: RoomReportInput = {
  roomId: "BK7P2X",
  summary: "We ship on Monday.",
  ideas: [
    { text: "Ship on Monday", score: 5, voters: 5, status: "accepted" },
    { text: "Ship on Friday", score: -3, voters: 4, status: "dropped" },
    { text: "Maybe Tuesday", score: 0, voters: 2, status: "open" },
  ],
  contributorLabels: ["Sarah", "Khalid"],
  hoursOpen: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  locale: "en",
};

describe("the report keeps what was decided", () => {
  it("separates accepted, dropped and open", () => {
    const report = buildRoomReport(base);

    expect(report.accepted.map((i) => i.text)).toEqual(["Ship on Monday"]);
    expect(report.dropped.map((i) => i.text)).toEqual(["Ship on Friday"]);
    expect(report.open.map((i) => i.text)).toEqual(["Maybe Tuesday"]);
  });

  it("keeps dropped ideas rather than discarding them", () => {
    // A decision that was rejected is evidence of what was considered. A report showing only
    // what won reads as though nothing else was ever on the table.
    const report = buildRoomReport(base);
    expect(report.ideas).toHaveLength(3);
  });

  it("carries the host's summary, not the transcript", () => {
    const report = buildRoomReport(base);
    expect(report.summary).toBe("We ship on Monday.");
  });

  it("states what was deleted, because a report is the surviving half of a room", () => {
    const report = buildRoomReport(base);
    expect(report.footer).toMatch(/deleted when the room closed/i);
  });
});

describe("bilingual output", () => {
  it("writes Arabic copy and right-to-left layout when asked", () => {
    const html = renderRoomReportHtml(buildRoomReport({ ...base, locale: "ar" }), "ar");

    // `dir` and `lang` are the whole difference between a translated document and a
    // translated-looking one that still reads wrong.
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("تقرير الغرفة");
    expect(html).toContain("القرارات");
  });

  it("writes English copy and left-to-right layout by default", () => {
    const html = renderRoomReportHtml(buildRoomReport(base), "en");

    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Room report");
  });

  it("renders Arabic member text without mangling it", () => {
    const html = renderRoomReportHtml(
      buildRoomReport({
        ...base,
        locale: "ar",
        ideas: [{ text: "ننشر يوم الاثنين", score: 2, voters: 2, status: "accepted" }],
      }),
      "ar",
    );

    // The characters must survive as themselves. A mangled string would mean the source was
    // re-encoded somewhere between the room and the file.
    expect(html).toContain("ننشر يوم الاثنين");
  });

  it("carries no English into an Arabic report's headings", () => {
    const html = renderRoomReportHtml(buildRoomReport({ ...base, locale: "ar" }), "ar");
    // The footer is the one English line allowed to remain a marker rather than content, and
    // even it is translated. This catches a half-finished translation table.
    expect(html).not.toContain("<h2>Room report</h2>");
  });
});

describe("escaping", () => {
  it("escapes a script tag typed by a member", () => {
    const html = renderRoomReportHtml(
      buildRoomReport({
        ...base,
        ideas: [
          {
            text: "<script>alert(1)</script>",
            score: 1,
            voters: 1,
            status: "accepted",
          },
        ],
      }),
      "en",
    );

    // A report is a file the host may open later, in a viewer that renders HTML. An
    // unescaped idea would be a script running in that viewer, written by a room member.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the summary too", () => {
    const html = renderRoomReportHtml(
      buildRoomReport({ ...base, summary: '<img src=x onerror="alert(1)">' }),
      "en",
    );

    expect(html).not.toContain("onerror=\"alert(1)\"");
  });

  it("escapes contributor names", () => {
    const html = renderRoomReportHtml(
      buildRoomReport({ ...base, contributorLabels: ["<b>Sarah</b>"] }),
      "en",
    );

    expect(html).not.toContain("<b>Sarah</b>");
  });
});

describe("the printed file", () => {
  it("carries print CSS so a PDF does not split an idea across pages", () => {
    const html = renderRoomReportHtml(buildRoomReport(base), "en");

    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
  });

  it("is self-contained, so it opens with no network", () => {
    const html = renderRoomReportHtml(buildRoomReport(base), "en");

    // A report the host keeps may be opened months later, offline. A stylesheet link or a
    // webfont would render it as unstyled text at exactly that moment.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("says so plainly when nothing was decided", () => {
    const html = renderRoomReportHtml(
      buildRoomReport({
        ...base,
        ideas: [{ text: "An idea", score: 0, voters: 0, status: "open" }],
      }),
      "en",
    );

    // An empty report must not read as a broken one. "No decision" is a real outcome.
    expect(html).toMatch(/produced no decision/i);
  });
});