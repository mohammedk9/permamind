import { describe, expect, it } from "vitest";
import { applyWebContext, buildWebContext, shouldSearchWeb } from "../web-context";

describe("Exa web context", () => {
  it("searches automatically for internet queries and manually when enabled", () => {
    expect(shouldSearchWeb("what is the latest Next.js release", false)).toBe(true);
    expect(shouldSearchWeb("help me rewrite this paragraph", false)).toBe(false);
    expect(shouldSearchWeb("help me rewrite this paragraph", true)).toBe(true);
    expect(shouldSearchWeb("   ", true)).toBe(false);
  });

  it("formats sources and reports an empty result set", () => {
    const context = buildWebContext("latest docs", [
      { title: "Docs", url: "https://example.com/docs", text: "Current release notes" },
    ]);
    expect(context).toContain("1. Docs");
    expect(context).toContain("Source: https://example.com/docs");
    expect(context.endsWith("User question:\nlatest docs")).toBe(true);

    expect(buildWebContext("today", [])).toContain("no results");
  });

  it("replaces only the latest user message and stays within the request limit", () => {
    const huge = "y".repeat(30_000);
    const messages = applyWebContext(
      [{ role: "system", content: "memory" }, { role: "user", content: "old" }, { role: "user", content: "new" }],
      "new",
      [{ title: "Result", url: "https://example.com", text: huge }],
    );
    expect(messages[1]?.content).toBe("old");
    expect(messages[2]?.content.length).toBeLessThanOrEqual(20_000);
    expect(messages[2]?.content).toContain("Source: https://example.com");
  });
});
