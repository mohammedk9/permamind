import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadApiSettings, saveApiSettings } from "@/lib/settings/api-key-storage";

const SECRET = "sk-abcdef1234567890abcdef";

describe("API key never reaches localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps the key in sessionStorage only", () => {
    saveApiSettings({ mode: "byok", apiKey: SECRET, provider: "openai" });

    expect(sessionStorage.getItem("permamind:api-key:v1")).toBe(SECRET);
  });

  it("persists every localStorage value without the key anywhere", () => {
    saveApiSettings({ mode: "byok", apiKey: SECRET, provider: "openai", modelName: "gpt-4o", baseUrl: "" });

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!;
      const value = localStorage.getItem(key)!;
      expect(value).not.toContain(SECRET);
      expect(value).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    }
  });

  it("still persists the non-secret preferences", () => {
    saveApiSettings({ mode: "byok", apiKey: SECRET, provider: "deepseek", modelName: "chat", validatedAt: "2026-01-01T00:00:00.000Z" });

    const settings = loadApiSettings();
    expect(settings.mode).toBe("byok");
    expect(settings.provider).toBe("deepseek");
    expect(settings.modelName).toBe("chat");
    // The key is still read back, from sessionStorage.
    expect(settings.apiKey).toBe(SECRET);
  });

  it("round-trips the key within a session", () => {
    saveApiSettings({ mode: "byok", apiKey: SECRET, provider: "openrouter" });
    expect(loadApiSettings().apiKey).toBe(SECRET);

    // A new browser session clears sessionStorage, which is the whole point.
    sessionStorage.clear();
    expect(loadApiSettings().apiKey).toBeUndefined();
  });

  it("clears the session key when the user returns to free mode", () => {
    saveApiSettings({ mode: "byok", apiKey: SECRET, provider: "openrouter" });
    saveApiSettings({ mode: "free", apiKey: SECRET });

    expect(sessionStorage.getItem("permamind:api-key:v1")).toBeNull();
    expect(loadApiSettings().apiKey).toBeUndefined();
  });
});
