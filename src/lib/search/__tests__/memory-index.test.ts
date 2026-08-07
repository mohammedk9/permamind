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
});