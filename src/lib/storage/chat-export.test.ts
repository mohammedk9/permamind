import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types/chat";
import { buildConversationExport } from "./chat-export";

const conversations: Conversation[] = [{
  id: "conversation-1",
  title: "Private project",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  syncToCloud: true,
  messages: [
    { id: "m1", role: "user", content: "secret message", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "m2", role: "assistant", content: "   ", createdAt: new Date("2026-01-01T00:01:00.000Z"), isStreaming: true },
  ],
}];

describe("conversation export", () => {
  it("includes full local messages and excludes sync secrets", () => {
    const exported = buildConversationExport(conversations, new Date("2026-01-03T00:00:00.000Z"));
    const serialized = JSON.stringify(exported);

    expect(exported.conversations).toHaveLength(1);
    expect(exported.conversations[0]?.messages).toEqual([
      expect.objectContaining({ content: "secret message" }),
    ]);
    expect(serialized).not.toContain("syncToCloud");
    expect(serialized).not.toContain("passphrase");
    expect(serialized).not.toContain("apiKey");
  });
});
