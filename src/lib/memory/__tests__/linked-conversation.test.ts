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
    // The only system message is the reply-language rule, which is required
    // even with no memory so the first message of a new conversation still
    // answers in the user's language. No linked-conversation context may leak
    // in, and the user's own message must be passed through untouched.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).not.toContain("Linked conversation");
    expect(messages[0].content).not.toContain("Retrieved memories");
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("keeps the user's original message and never duplicates it", () => {
    const messages = buildMessagesWithMemory(
      [{ role: "system", content: "stale" }, { role: "user", content: "مرحبا" }],
      [],
      false,
      "",
      [],
      ""
    );
    expect(messages.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "مرحبا" },
    ]);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).not.toContain("stale");
  });

  it("asks for an Arabic reply when the latest user message is Arabic", () => {
    const messages = buildMessagesWithMemory([{ role: "user", content: "ما رأيك في البيتكوين؟" }], [], false, "", [], "");
    // The rule names the required language first, then names the forbidden one.
    expect(messages[0].content).toMatch(/^Always write your reply in Arabic/);
    expect(messages[0].content).toContain("Never switch to English");
  });

  it("asks for an English reply when the latest user message is English", () => {
    const messages = buildMessagesWithMemory([{ role: "user", content: "what do you think of bitcoin?" }], [], false, "", [], "");
    expect(messages[0].content).toMatch(/^Always write your reply in English/);
    expect(messages[0].content).toContain("Never switch to Arabic");
  });

  it("keeps Arabic as the reply language when a few English words are mixed in", () => {
    const messages = buildMessagesWithMemory(
      [{ role: "user", content: "ما رأيك في مشروع Atlas الجديد؟" }],
      [],
      false,
      "",
      [],
      ""
    );
    expect(messages[0].content).toMatch(/^Always write your reply in Arabic/);
  });
});
