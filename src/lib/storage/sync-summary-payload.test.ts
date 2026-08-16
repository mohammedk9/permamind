import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/types/chat";
import { setSyncPassphrase } from "./sync-encryption";
import { uploadConversationSummary } from "./sync-client";

const conversation: Conversation = {
  id: "conversation-1",
  title: "Private project",
  messages: [{ id: "m1", role: "user", content: "secret message", createdAt: new Date() }],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  metadata: {
    summary: "Private summary",
    topics: ["private"],
    tags: [],
    entities: [],
    messageFingerprint: "fingerprint",
    generatedAt: new Date(),
  },
};

describe("cloud summary payload", () => {
  beforeEach(() => {
    setSyncPassphrase("a sufficiently strong sync password");
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = String(init?.body);
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      expect(body.ciphertext).toBeTypeOf("string");
      expect(body.ciphertext).not.toContain("Private summary");
      expect(body.ciphertext).not.toContain("secret message");
      expect(rawBody).not.toContain("Private summary");
      expect(rawBody).not.toContain("secret message");
      expect(rawBody).not.toContain("a sufficiently strong sync password");
      expect(body).not.toHaveProperty("summary");
      expect(body).not.toHaveProperty("messages");
      expect(body).not.toHaveProperty("syncPassphrase");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });

  it("sends encrypted summary content only", async () => {
    await expect(uploadConversationSummary(conversation)).resolves.toBe("uploaded");
  });
});