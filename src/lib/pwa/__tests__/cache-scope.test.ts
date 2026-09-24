import { describe, expect, it } from "vitest";
import { isCacheableRequest } from "@/lib/pwa/cache-scope";

describe("PWA cache scope", () => {
  it("caches app pages and static assets", () => {
    expect(isCacheableRequest(new URL("https://permamind.app/chat"))).toBe(true);
    expect(isCacheableRequest(new URL("https://permamind.app/manifest.json"))).toBe(true);
    expect(isCacheableRequest(new URL("https://permamind.app/_next/static/chunk.js"))).toBe(true);
  });

  it("never caches API requests", () => {
    expect(isCacheableRequest(new URL("https://permamind.app/api/chat"))).toBe(false);
    expect(isCacheableRequest(new URL("https://permamind.app/api/search?q=test"))).toBe(false);
  });
});
