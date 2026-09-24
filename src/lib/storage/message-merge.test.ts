import { describe, expect, it } from "vitest";
import { mergeConversationsByMessage } from "./message-merge";
import type { Conversation } from "@/types/chat";

const conversation = (content: string, reason = "local reason"): Conversation => ({
  id: "chat",
  title: "Chat",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  messages: [{ id: "m1", role: "user", content, createdAt: new Date("2026-01-01T00:00:00.000Z") }],
  metadata: { summary: "", topics: [], tags: [], entities: [], messageFingerprint: "x", generatedAt: new Date("2026-01-02T00:00:00.000Z"), decisions: [{ decision: "Storage policy", reason, status: "active" }] },
});

describe("message merge", () => {
  it("adds only the missing message instead of replacing the conversation", () => {
    const local = conversation("hello");
    local.messages.push({ id: "m2", role: "assistant", content: "local only", createdAt: new Date("2026-01-01T01:00:00.000Z") });
    const remote = conversation("hello");
    remote.messages.push({ id: "m3", role: "assistant", content: "remote only", createdAt: new Date("2026-01-01T02:00:00.000Z") });
    const result = mergeConversationsByMessage([local], [remote]);
    expect(result.conversations[0].messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
    expect(result.conflictedMessages).toBe(0);
  });

  it("keeps both versions when the same message id has different content", () => {
    const result = mergeConversationsByMessage([conversation("local text")], [conversation("remote text")]);
    expect(result.conversations[0].messages).toHaveLength(2);
    expect(result.conflictedMessages).toBe(1);
  });

  it("does not silently overwrite a conflicting decision", () => {
    const result = mergeConversationsByMessage([conversation("hello", "Keep summaries")], [conversation("hello", "Store full chats")]);
    const decisions = result.conversations[0].metadata?.decisions ?? [];
    expect(decisions).toHaveLength(2);
    expect(decisions[0].status).toBe("active");
    expect(decisions[1].status).toBe("uncertain");
    expect(result.conflictedDecisions).toBe(1);
  });
});
