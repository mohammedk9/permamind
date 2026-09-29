import React from "react";
import { render } from "@testing-library/react";
import { ProviderRail } from "@/components/landing/provider-showcase";

/** The rail renders one span per model; the label is the only <p>. */
const chips = () =>
  Array.from(document.querySelectorAll("span")).map((node) => node.textContent ?? "");

describe("Provider rail", () => {
  it("repeats the supported models so the loop never runs out of content", () => {
    render(<ProviderRail label="Works with the models you already use" />);

    const names = chips();
    const unique = new Set(names);
    const sets = names.length / unique.size;

    // The keyframe wraps at -50%, so an odd set count would break the seam and
    // leave fewer than two full passes on screen.
    expect(sets).toBeGreaterThanOrEqual(4);
    expect(sets % 2).toBe(0);
  });

  it("lists enough distinct providers to fill a wide screen", () => {
    render(<ProviderRail label="Works with the models you already use" />);

    // Every name appears exactly once per pass, and one pass is wider than a
    // large display so the repeated pass stays out of view.
    const unique = new Set(chips());
    expect(unique.size).toBe(17);
    expect(unique).toContain("OpenRouter");
    expect(unique).toContain("Ollama");
  });

  it("keeps every chip in the same order within a set", () => {
    render(<ProviderRail label="Works with the models you already use" />);

    const names = chips();
    const setSize = new Set(names).size;
    const firstSet = names.slice(0, setSize);
    const secondSet = names.slice(setSize, setSize * 2);

    expect(secondSet).toEqual(firstSet);
  });
});