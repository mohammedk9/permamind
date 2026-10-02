import { beforeEach, describe, expect, it } from "vitest";

import { applyTheme, resolveTheme } from "@/hooks/use-theme";

describe("resolveTheme", () => {
  it("prefers an explicit choice over the system preference", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("follows the system when the user has not chosen", () => {
    expect(resolveTheme(null, "dark")).toBe("dark");
    expect(resolveTheme(null, "light")).toBe("light");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("adds the dark class and sets the native colour scheme for dark", () => {
    applyTheme("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  /* The `dark:` Tailwind variant keys off this class, so a leftover value after
     switching to light would leave every dark-mode surface painted black on a
     white page. This is the regression the toggle exists to prevent. */
  it("removes the dark class for light", () => {
    document.documentElement.classList.add("dark");

    applyTheme("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("is idempotent when the same theme is applied twice", () => {
    applyTheme("light");
    applyTheme("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});