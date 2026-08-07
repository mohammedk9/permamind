import { describe, expect, it } from "vitest";
import { conversationIncludedByPolicy, filterConversationsByPolicy } from "../storage-policy";
import type { Conversation } from "@/types/chat";

const conversation = (id: string, flags: Partial<Conversation> = {}): Conversation => ({
  id, title: id, messages: [], createdAt: new Date(), updatedAt: new Date(), ...flags,
});

describe("storage policies", () => {
  it("filters starred and manually selected conversations", () => {
    const all = [conversation("all"), conversation("star", { starred: true }), conversation("manual", { permanentMemory: true })];
    expect(filterConversationsByPolicy(all, "store_everything")).toHaveLength(3);
    expect(filterConversationsByPolicy(all, "starred_only").map((c) => c.id)).toEqual(["star"]);
    expect(filterConversationsByPolicy(all, "manual_only").map((c) => c.id)).toEqual(["manual"]);
    expect(filterConversationsByPolicy(all, "manual_backups_only")).toEqual([]);
  });
  it("uses explicit permanent and starred flags", () => {
    expect(conversationIncludedByPolicy(conversation("x", { starred: true }), "starred_only")).toBe(true);
    expect(conversationIncludedByPolicy(conversation("x", { permanentMemory: true }), "manual_only")).toBe(true);
  });
});