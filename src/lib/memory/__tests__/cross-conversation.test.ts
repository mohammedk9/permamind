import { describe, expect, it } from "vitest";
import { buildMessagesWithMemory } from "../context";
import {
  isPreviousConversationQuery,
  previousConversationSearchQuery,
  retrieveRelevantMemories,
} from "../retrieve";
import type { Conversation } from "@/types/chat";

const date = new Date("2026-01-01T00:00:00Z");
const conversations: Conversation[] = [{
  id: "old", title: "Project notes", createdAt: date, updatedAt: date,
  messages: [
    { id: "u1", role: "user", content: "My previous project was Atlas", createdAt: date },
    { id: "a1", role: "assistant", content: "We planned an Atlas deployment with a blue-green rollout.", createdAt: date },
  ],
}];

describe("reliable cross-conversation recall", () => {
  it("detects previous-conversation phrasing and keeps the subject", () => {
    expect(isPreviousConversationQuery("did we talk about Atlas?")).toBe(true);
    expect(previousConversationSearchQuery("did we talk about Atlas?")).toBe("Atlas?");
    expect(isPreviousConversationQuery("what did you say before")).toBe(true);
  });

  it("retrieves the exact stored message, not only metadata", () => {
    const memories = retrieveRelevantMemories("Atlas", conversations, null, true);
    expect(memories.some((memory) => memory.excerpt === "My previous project was Atlas" && memory.messageId === "u1")).toBe(true);
  });

  it("retrieves a prior conversation for a generic what-did-you-say query", () => {
    const memories = retrieveRelevantMemories("", conversations, null, true);
    expect(memories.length).toBeGreaterThan(0);
  });

  it("instructs the model not to hallucinate when memory is missing", () => {
    const messages = buildMessagesWithMemory([{ role: "user", content: "what did you say before" }], [], true);
    expect(messages[0].content).toContain("no previous conversation was found");
    expect(messages[0].content).toContain("Do not answer from general knowledge");
  });
});