import { describe, expect, it } from "vitest";
import { planConversationMerge } from "./sync-merge";
import type { Conversation } from "@/types/chat";

const conversation = (id: string, updatedAt: string): Conversation => ({
  id,
  title: id,
  messages: [],
  createdAt: new Date(updatedAt),
  updatedAt: new Date(updatedAt),
});

describe("sync merge", () => {
  it("keeps local data when the remote copy is not newer", () => {
    const local = conversation("same", "2026-01-02T00:00:00.000Z");
    const result = planConversationMerge([local], [conversation("same", "2026-01-01T00:00:00.000Z")]);
    expect(result.merged[0]).toBe(local);
    expect(result.keptLocal).toBe(1);
  });

  it("adds new items and replaces only older local items", () => {
    const result = planConversationMerge(
      [conversation("old", "2026-01-01T00:00:00.000Z")],
      [conversation("old", "2026-01-03T00:00:00.000Z"), conversation("new", "2026-01-02T00:00:00.000Z")],
    );
    expect(result.added).toBe(1);
    expect(result.replaced).toBe(1);
    expect(result.merged).toHaveLength(2);
  });
});