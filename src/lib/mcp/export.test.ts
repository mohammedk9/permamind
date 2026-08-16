import { buildMcpExport } from "./export";
import type { Conversation } from "@/types/chat";

const conversations: Conversation[] = [
  { id: "one", title: "One", messages: [{ id: "m1", role: "user", content: "private one", createdAt: new Date("2026-01-01") }], createdAt: new Date(), updatedAt: new Date(), metadata: { summary: "summary one", topics: [], tags: [], entities: [], messageFingerprint: "", generatedAt: new Date() }, syncToCloud: true, projectId: "secret-project" },
  { id: "two", title: "Two", messages: [{ id: "m2", role: "assistant", content: "private two", createdAt: new Date("2026-01-02") }], createdAt: new Date(), updatedAt: new Date(), metadata: { summary: "summary two", topics: [], tags: [], entities: [], messageFingerprint: "", generatedAt: new Date() } },
];

describe("buildMcpExport", () => {
  it("exports only selected conversations", () => {
    const result = buildMcpExport(conversations, { conversationIds: ["two"], contentLevel: "titles" });
    expect(result.data.conversations).toHaveLength(1);
    expect(result.data.conversations[0]).toEqual({ id: "two", title: "Two" });
    expect(result.policy.conversationIds).toEqual(["two"]);
  });

  it("does not include messages when summaries are selected", () => {
    const result = buildMcpExport(conversations, { conversationIds: ["one"], contentLevel: "summaries" });
    expect(result.data.conversations[0]).toEqual({ id: "one", title: "One", summary: "summary one" });
    expect(result.policy.allowMessages).toBe(false);
  });

  it("has no broad permissions by default", () => {
    const result = buildMcpExport(conversations);
    expect(result).toEqual({ data: { version: 1, conversations: [] }, policy: { conversationIds: [], allowTitles: false, allowSummaries: false, allowMessages: false, allowSearch: false } });
  });

  it("does not export application flags or secrets", () => {
    const result = buildMcpExport(conversations, { conversationIds: ["one"], contentLevel: "messages" });
    expect(JSON.stringify(result)).not.toMatch(/syncToCloud|projectId|apiKey|password|arweave/i);
  });
});