import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpsUrl, fetchPublicHttps, isLocalOllamaUrl, isSafeCustomUrl, resolveRequestAuth, type DnsLookup } from "../request-auth";

const publicLookup: DnsLookup = async () => [{ address: "8.8.8.8" }];

describe("custom provider URL protection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects credentials, ports, local names, and literal private addresses", () => {
    expect(isSafeCustomUrl("https://api.example.com/v1")).toBe(true);
    for (const url of [
      "http://api.example.com/v1",
      "https://user:secret@api.example.com/v1",
      "https://api.example.com:8443/v1",
      "https://localhost/v1",
      "https://server.internal/v1",
      "https://127.0.0.1/v1",
      "https://10.1.2.3/v1",
      "https://169.254.169.254/latest",
      "https://[::1]/v1",
    ]) expect(isSafeCustomUrl(url)).toBe(false);
  });

  it("rejects a public-looking host whose DNS answer is private", async () => {
    const resolve: DnsLookup = async () => [{ address: "8.8.8.8" }, { address: "169.254.169.254" }];
    await expect(assertPublicHttpsUrl("https://tunnel.example/v1", resolve)).rejects.toThrow(/public address/);
  });

  it("does not follow a redirect or send the key until its target is public", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      seen.push(`${url.href} ${new Headers(init.headers).get("authorization")}`);
      return new Response(null, { status: seen.length === 1 ? 302 : 200, headers: seen.length === 1 ? { location: "https://metadata.internal/latest" } : {} });
    }));
    const resolve: DnsLookup = async (hostname) => hostname === "safe.example" ? [{ address: "8.8.8.8" }] : [{ address: "127.0.0.1" }];

    await expect(fetchPublicHttps(new URL("https://safe.example/v1/chat/completions"), {
      method: "POST",
      headers: { Authorization: "Bearer user-secret" },
    }, resolve)).rejects.toThrow(/public address/);

    expect(seen).toEqual(["https://safe.example/v1/chat/completions Bearer user-secret"]);
  });

  it("allows a redirect only after the next public DNS check", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(url.hostname === "first.example" ? null : "ok", {
      status: url.hostname === "first.example" ? 307 : 200,
      headers: url.hostname === "first.example" ? { location: "https://second.example/v1" } : {},
    })));
    const response = await fetchPublicHttps(new URL("https://first.example/v1"), { method: "POST" }, publicLookup);
    expect(response.status).toBe(200);
  });

  it("allows only the local Ollama address and sends no key", () => {
    expect(isLocalOllamaUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalOllamaUrl("http://10.0.0.8:11434/v1")).toBe(false);
    expect(isLocalOllamaUrl("https://127.0.0.1:11434/v1")).toBe(false);
    const request = new Request("https://app.example/api/chat", { headers: { "x-ai-provider": "ollama", "x-ai-base-url": "http://127.0.0.1:11434/v1", "x-ai-model": "llama3.1" } });
    expect(resolveRequestAuth(request)).toMatchObject({ provider: "ollama", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" });
    const remote = new Request("https://app.example/api/chat", { headers: { "x-ai-provider": "ollama", "x-ai-base-url": "http://10.0.0.8:11434/v1", "x-ai-model": "llama3.1" } });
    expect(() => resolveRequestAuth(remote)).toThrow(/this device/);
  });
});
