import { describe, expect, it } from "vitest";
import { buildMemoryIndex, searchMemoryIndex } from "../memory-index";
import type { Conversation } from "@/types/chat";

const date = new Date("2026-01-01");
const conversations: Conversation[] = [
  { id: "project", title: "Project notes", messages: [{ id: "m1", role: "user", content: "Discuss deployment", createdAt: date }], createdAt: date, updatedAt: date, metadata: { summary: "Deployment planning", topics: ["Infrastructure"], tags: ["work"], entities: ["Acme"], messageFingerprint: "", generatedAt: date } },
  { id: "other", title: "Other", messages: [{ id: "m2", role: "user", content: "Deployment", createdAt: date }], createdAt: date, updatedAt: date },
];

describe("memory search", () => {
  it("indexes metadata and ranks title/summary matches above message-only matches", () => {
    const results = searchMemoryIndex(buildMemoryIndex(conversations), "deployment");
    expect(results.some((result) => result.matchType === "summary")).toBe(true);
    expect(results[0].conversationId).toBe("project");
  });

  it("returns offsets suitable for highlighting", () => {
    const result = searchMemoryIndex(buildMemoryIndex(conversations), "notes")[0];
    expect(result.snippet.slice(result.matchStart, result.matchEnd).toLowerCase()).toBe("notes");
  });

  it("finds Arabic text whatever its harakat or hamza", () => {
    const date = new Date("2026-01-01");
    const arabic: Conversation[] = [
      {
        id: "c1",
        title: "خطة الإطلاق",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "قَرَّرْنا تَأْجِيلَ الإِطْلاقِ أسبوعاً إضافياً",
            createdAt: date,
          },
        ],
        createdAt: date,
        updatedAt: date,
      },
    ];

    // The query carries no harakat and a plain hamza; the stored text does not.
    const results = searchMemoryIndex(buildMemoryIndex(arabic), "الإطلاق");

    expect(results.length).toBeGreaterThan(0);
    // The title matches too, so check the message hit specifically: its highlight
    // must land on the stored spelling, not on normalised text.
    const highlighted = results.map((hit) => hit.snippet.slice(hit.matchStart, hit.matchEnd));
    expect(highlighted.some((text) => text.includes("الإِطْلاقِ"))).toBe(true);
  });

  it("matches a bare word inside its definite-article form", () => {
    const date = new Date("2026-01-01");
    const arabic: Conversation[] = [
      {
        id: "c1",
        title: "اجتماع",
        messages: [
          { id: "m1", role: "user", content: "عدنا إلى القرار بعد يومين", createdAt: date },
        ],
        createdAt: date,
        updatedAt: date,
      },
    ];

    const results = searchMemoryIndex(buildMemoryIndex(arabic), "قرار");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain("القرار");
  });
});
