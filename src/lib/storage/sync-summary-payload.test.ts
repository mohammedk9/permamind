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

  it("omits the plaintext summary unless MCP access is explicit", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = String(init?.body);
      bodies.push(rawBody);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    // No `mcpAllowed`: the row must carry ciphertext and nothing readable.
    await uploadConversationSummary(conversation);

    const body = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(body.mcpAllowed).toBe(false);
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("title");
    // The encrypted payload still contains the summary, so a restore is lossless.
    expect(bodies[0]).not.toContain("Private summary");
  });

  it("sends plaintext summary fields only after an explicit MCP opt-in", async () => {
    let received: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      received = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    await uploadConversationSummary({ ...conversation, mcpAllowed: true });

    expect(received).not.toBeNull();
    expect(received!.mcpAllowed).toBe(true);
    expect(received!.summary).toBe("Private summary");
  });

  it("deletes only the selected cloud summary", async () => {
    const { deleteConversationSummary } = await import("./sync-client");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sync/summaries?conversationId=conversation-1");
      expect(init?.method).toBe("DELETE");
      expect(init?.body).toBeUndefined();
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }));

    await expect(deleteConversationSummary(conversation.id)).resolves.toBeUndefined();
  });
});