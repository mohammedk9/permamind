import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The hero headline renders three lines. The middle one is painted with a
 * `bg-clip-text` gradient, which forces `color: transparent` onto that span.
 * The closing line therefore needs its own colour, or it renders greyed out
 * (or invisible) because it inherits the transparent fill.
 *
 * This reads the source rather than the DOM: `page.tsx` is a client component
 * whose translations come from localStorage, so a rendered assertion would
 * depend on browser state that jsdom does not share with the real page.
 */
describe("Hero headline", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf-8");

  const closingLine = source
    .split("\n")
    .find((line) => line.includes("{t.heroTitleEnd}"));

  it("renders the closing line of the headline", () => {
    expect(closingLine).toBeDefined();
  });

  it("gives the closing line an explicit colour so it is not transparent", () => {
    // The class must sit on the same element that wraps heroTitleEnd.
    const element = source
      .split("\n")
      .slice(
        source.split("\n").findIndex((line) => line.includes("{t.heroTitleEnd}")) - 2,
      )
      .join(" ");
    expect(element).toMatch(/text-foreground/);
  });
});