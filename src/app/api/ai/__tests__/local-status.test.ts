import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/ai/local-status/route";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ollamaReply(models: Array<{ name: string }>) {
  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/ai/local-status", () => {
  it("reports the models the local daemon has pulled", async () => {
    fetchMock.mockResolvedValue(ollamaReply([{ name: "qwen2.5:3b" }, { name: "llama3.2:1b" }]));

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/tags",
      expect.objectContaining({ cache: "no-store" }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      models: ["qwen2.5:3b", "llama3.2:1b"],
    });
  });

  it("answers ok:false rather than an error when nothing is installed", async () => {
    // Connection refused is the normal first-run state, not a server fault.
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434"));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false, models: [] });
  });

  it("treats a running daemon with no models as not usable", async () => {
    fetchMock.mockResolvedValue(ollamaReply([]));

    await expect(GET().then((response) => response.json())).resolves.toEqual({
      ok: true,
      models: [],
    });
  });

  it("does not throw when the daemon answers with something that is not Ollama", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>not ollama</html>", { status: 200 }),
    );

    await expect(GET().then((response) => response.json())).resolves.toEqual({
      ok: false,
      models: [],
    });
  });

  it("never accepts a caller-supplied address", async () => {
    fetchMock.mockResolvedValue(ollamaReply([{ name: "qwen2.5:3b" }]));

    const response = await GET();

    // Only the fixed local address is ever probed: a request parameter would
    // turn this into a server-side request forwarder.
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/tags");
    await expect(response.json()).resolves.toEqual({ ok: true, models: ["qwen2.5:3b"] });
  });
});