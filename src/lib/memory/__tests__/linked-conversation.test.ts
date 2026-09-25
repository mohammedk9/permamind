import { describe, expect, it } from "vitest";
import { buildMessagesWithMemory, linkedConversationContext } from "../context";
import { retrieveRelevantMemories } from "../retrieve";
import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import type { Conversation } from "@/types/chat";

const date = new Date("2026-01-01T00:00:00Z");
const source: Conversation = {
  id: "source", title: "Atlas plan", createdAt: date, updatedAt: date,
  metadata: { summary: "Plan the Atlas launch", topics: [], tags: [], entities: [], messageFingerprint: "a", generatedAt: date },
  messages: [
    { id: "u", role: "user", content: "Use a blue-green rollout", createdAt: date },
    { id: "a", role: "assistant", content: "The rollout starts Tuesday", createdAt: date },
  ],
};
const current: Conversation = { id: "current", title: "New", createdAt: date, updatedAt: date, messages: [], linkedConversationIds: ["source", "missing", "current"] };

describe("optional linked conversations", () => {
  it("keeps an explicit link through local storage", () => {
    saveChatData([current], current.id, []);
    expect(loadChatData().conversations[0].linkedConversationIds).toEqual(["source", "missing"]);
  });

  it("uses the linked conversation as primary context without replacing general memory", () => {
    const context = linkedConversationContext(current, [source, current]);
    const memories = retrieveRelevantMemories("Atlas", [source, current], current.id);
    const messages = buildMessagesWithMemory([{ role: "user", content: "continue" }], memories, false, "", [], context);
    expect(context).toContain("Atlas plan");
    expect(context).toContain("blue-green rollout");
    expect(messages[0].content.indexOf("primary context")).toBeLessThan(messages[0].content.indexOf("Retrieved memories"));
    expect(messages[0].content).toContain("blue-green rollout");
  });

  it("sends normally when no conversation is linked", () => {
    const messages = buildMessagesWithMemory([{ role: "user", content: "hello" }], [], false, "", [], "");
    expect(messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
