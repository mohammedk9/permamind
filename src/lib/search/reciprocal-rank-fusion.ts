/**
 * Reciprocal Rank Fusion.
 *
 * Merging a lexical score with a cosine similarity by adding them together, as
 * `mergeSemanticMemories` did, is unsound: the two numbers live on unrelated
 * scales. A cosine of 0.31 and an overlap score of 0.62 are not comparable
 * quantities, so whichever happened to be larger dominated the result and the
 * other ranking contributed almost nothing.
 *
 * RRF sidesteps scale entirely by looking only at positions. A document ranked
 * first by either retriever gets a large contribution; a document ranked 40th
 * gets a small one. No calibration, no weighting guesswork, and no way for one
 * broken retriever to silence the other.
 *
 * This is the fusion used by the Azure Cognitive Search paper (Cormack et al.)
 * and it is what production hybrid search systems converge on.
 */

/** The standard constant. 60 flattens the curve so a single rank cannot dominate. */
const DEFAULT_RRF_CONSTANT = 60;

export interface RankedItem {
  id: string;
}

export interface FusedItem<T extends RankedItem> {
  id: string;
  score: number;
  /** Which retrievers placed this item, and at what rank. Useful for debugging. */
  sources: Array<{ retriever: string; rank: number }>;
}

/**
 * Fuses several ranked lists into one.
 *
 * Every list is already sorted best-first. An item that no retriever returned
 * cannot appear, so callers must pass complete candidate lists rather than
 * already-truncated top-k slices.
 */
export function reciprocalRankFusion<T extends RankedItem>(
  lists: Array<{ name: string; items: T[] }>,
  options: { constant?: number; limit?: number } = {},
): Array<FusedItem<T>> {
  const { constant = DEFAULT_RRF_CONSTANT, limit = 20 } = options;
  const fused = new Map<string, FusedItem<T>>();

  for (const list of lists) {
    list.items.forEach((item, index) => {
      const rank = index + 1;
      const contribution = 1 / (constant + rank);
      const existing = fused.get(item.id);
      if (existing) {
        existing.score += contribution;
        existing.sources.push({ retriever: list.name, rank });
        return;
      }
      fused.set(item.id, { id: item.id, score: contribution, sources: [{ retriever: list.name, rank }] });
    });
  }

  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}
