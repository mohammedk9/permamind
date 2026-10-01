import { describe, expect, it } from "vitest";

import { buildBm25Index } from "@/lib/search/bm25";

/**
 * The failure this replaces: with one point per matching token, a term present
 * in every document scored exactly the same as a term present in one. After a
 * few dozen conversations every ranking became arbitrary.
 */
describe("BM25 ranking", () => {
  it("weights a rare term above a term that appears everywhere", () => {
    const index = buildBm25Index([
      { id: "common-1", text: "the project meeting discussed the budget timeline" },
      { id: "common-2", text: "the project status covered the budget and timeline" },
      { id: "common-3", text: "the project review noted the budget risk timeline" },
      { id: "rare", text: "the project covered a staging rollout plan" },
    ]);

    const hits = index.search("staging rollout plan");

    expect(hits[0]?.id).toBe("rare");
  });

  it("ranks a matching document above a non-matching one", () => {
    const index = buildBm25Index([
      { id: "unrelated", text: "cooking recipes for pasta and risotto" },
      { id: "match", text: "we chose a staged launch for the atlas project" },
    ]);

    expect(index.search("atlas launch")[0]?.id).toBe("match");
  });

  it("returns nothing when no query term appears", () => {
    const index = buildBm25Index([{ id: "a", text: "invoice details for march" }]);
    expect(index.search("quantum entanglement")).toEqual([]);
  });

  it("reports the query terms that matched", () => {
    const index = buildBm25Index([{ id: "a", text: "we decided to delay the launch by two weeks" }]);
    const hits = index.search("delay launch");
    expect(hits[0]?.matchedTerms.sort()).toEqual(["delay", "launch"]);
  });

  it("rewards a document containing the whole phrase", () => {
    const exact = buildBm25Index([
      { id: "phrase", text: "the user asked about the retry policy last week" },
      { id: "scattered", text: "retry logic was discussed, and separately the policy question came up" },
    ]);

    // The phrase document wins even though both contain every query term.
    expect(exact.search("retry policy")[0]?.id).toBe("phrase");
  });

  it("handles an empty corpus without throwing", () => {
    const index = buildBm25Index([]);
    expect(index.size).toBe(0);
    expect(index.search("anything")).toEqual([]);
    expect(index.maxScore).toBeGreaterThan(0);
  });

  it("skips documents that normalise to nothing", () => {
    const index = buildBm25Index([
      { id: "empty", text: "!!!" },
      { id: "real", text: "a real conversation about pricing" },
    ]);
    expect(index.size).toBe(1);
  });

  it("matches Arabic queries against Arabic documents", () => {
    const index = buildBm25Index([
      { id: "cooking", text: "\u0637\u0636\u0627\u0621 \u0648\u0635\u0641\u0627\u062a \u0627\u0644\u0637\u0639\u0627\u0645" },
      { id: "launch", text: "\u0642\u0631\u0631\u0646\u0627 \u0625\u0637\u0644\u0627\u0642 \u062a\u062f\u0631\u064a\u062c\u064a \u0641\u064a \u0627\u0644\u0625\u0637\u0644\u0627\u0642" },
    ]);

    expect(index.search("\u0625\u0637\u0644\u0627\u0642 \u062a\u062f\u0631\u064a\u062c\u064a")[0]?.id).toBe("launch");
  });

  it("treats differently spelled Arabic as the same term", () => {
    // إسلام and إسلام, and مدينة with and without the ta-marbuta, must not
    // split the document frequency count.
    const index = buildBm25Index([
      { id: "a", text: "\u0625\u0633\u0644\u0627\u0645 \u0648\u0645\u062f\u064a\u0646\u0629" },
      { id: "b", text: "\u0627\u0633\u0644\u0627\u0645 \u0648\u0645\u062f\u064a\u0646\u0647" },
      { id: "c", text: "\u062a\u0637\u0628\u064a\u0639 \u0627\u0644\u0643\u062a\u0628" },
    ]);

    expect(index.search("\u0625\u0633\u0644\u0627\u0645").map((hit) => hit.id).sort()).toEqual(["a", "b"]);
  });

  it("respects the requested result limit", () => {
    const documents = Array.from({ length: 30 }, (_, index) => ({
      id: `doc-${index}`,
      text: `conversation ${index} about the shared topic`,
    }));
    const index = buildBm25Index(documents);
    expect(index.search("shared topic", { limit: 5 })).toHaveLength(5);
  });
});
