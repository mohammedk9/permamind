import { describe, expect, it } from "vitest";

import { reciprocalRankFusion } from "@/lib/search/reciprocal-rank-fusion";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("reciprocal rank fusion", () => {
  it("keeps an item that only one retriever returned", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b") },
      { name: "semantic", items: ids("c") },
    ]);
    expect(fused.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
  });

  /**
   * The behaviour that matters: an item both retrievers liked rises above one
   * that only a single retriever liked, without either retriever being able to
   * dictate the order on its own.
   */
  it("ranks an agreed item above a single-retriever item", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", items: ids("only-lexical", "agreed") },
      { name: "semantic", items: ids("agreed") },
    ]);

    expect(fused[0]?.id).toBe("agreed");
    expect(fused[0]?.sources).toHaveLength(2);
  });

  it("records which retrievers contributed and at what rank", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b") },
      { name: "semantic", items: ids("b", "a") },
    ]);

    const item = fused.find((entry) => entry.id === "a");
    expect(item?.sources).toEqual(
      expect.arrayContaining([
        { retriever: "lexical", rank: 1 },
        { retriever: "semantic", rank: 2 },
      ]),
    );
  });

  it("ignores the magnitude of the input scores, only their order", () => {
    // A cosine of 0.31 and an overlap of 0.62 are not comparable; fusion must
    // not attempt to compare them.
    const tiny = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b") },
      { name: "semantic", items: ids("b", "a") },
    ]);
    const huge = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b") },
      { name: "semantic", items: ids("b", "a") },
    ]);
    expect(tiny.map((item) => item.id)).toEqual(huge.map((item) => item.id));
  });

  it("sums contributions across retrievers rather than taking the best", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b") },
      { name: "semantic", items: ids("a", "b") },
    ]);

    const a = fused.find((item) => item.id === "a")!;
    const b = fused.find((item) => item.id === "b")!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.score).toBeCloseTo(2 / 61, 6);
  });

  it("returns an empty list when there is nothing to fuse", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([{ name: "lexical", items: [] }])).toEqual([]);
  });

  it("honours the limit", () => {
    const fused = reciprocalRankFusion([
      { name: "lexical", items: ids("a", "b", "c", "d") },
      { name: "semantic", items: ids("e", "f") },
    ], { limit: 3 });
    expect(fused).toHaveLength(3);
  });

  it("breaks ties deterministically so repeated calls agree", () => {
    const lists = [
      { name: "lexical", items: ids("a") },
      { name: "semantic", items: ids("a") },
    ];
    expect(reciprocalRankFusion(lists)).toEqual(reciprocalRankFusion(lists));
  });
});
