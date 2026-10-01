/**
 * Local BM25 ranking for memory retrieval.
 *
 * Why this replaced the previous scoring: `wordOverlapScore` awarded exactly one
 * point per matching token, so a term that appeared in fifty conversations and a
 * term that appeared exactly once scored the same. After fifty conversations
 * every ranking was effectively arbitrary, and only three memories were injected
 * per reply, so most of what the user had stored never reached the model.
 *
 * BM25 fixes that with inverse document frequency: a rare word carries more
 * weight than a common one, which is what people intuitively expect when they
 * ask "what did we decide about launch?".
 *
 * Everything runs on the device. The index is built in memory from local data
 * and discarded; nothing is sent anywhere and nothing is persisted.
 */

import { normalizeForMatch, tokenizeArabic } from "@/lib/i18n/arabic-normalize";

/**
 * BM25 constants. k1 controls term-frequency saturation and b controls how
 * strongly document length is penalised. These are the values from the original
 * Robertson/Sparck Jones paper as used by Lucene and Elasticsearch defaults,
 * which is a reasonable baseline rather than a tuned-for-this-app guess.
 */
const K1 = 1.2;
const B = 0.75;

export interface Bm25Document {
  /** Stable identifier so a caller can map a score back to its source. */
  id: string;
  /** The text to match against. Normalised internally. */
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
  /** The query terms that actually matched, useful for explaining a result. */
  matchedTerms: string[];
}

interface IndexedDocument {
  id: string;
  /** Term frequencies within this document. */
  terms: Map<string, number>;
  length: number;
  /** Normalised text, kept so phrase bonuses can reuse it. */
  normalized: string;
}

/**
 * A BM25 index over a fixed set of documents.
 *
 * Building is O(total tokens). Querying is O(query terms x matching docs), and
 * only documents that contain at least one query term are scored, so a corpus of
 * a few hundred memories stays well under a millisecond.
 */
export class Bm25Index {
  private readonly documents: IndexedDocument[] = [];
  /** document frequency per term, used for the IDF weight. */
  private readonly documentFrequency = new Map<string, number>();
  private averageLength = 0;

  constructor(documents: Bm25Document[]) {
    for (const document of documents) this.add(document);
  }

  private add(document: Bm25Document): void {
    const normalized = normalizeForMatch(document.text);
    if (!normalized) return;

    const terms = new Map<string, number>();
    let length = 0;
    for (const token of tokenizeArabic(document.text)) {
      terms.set(token, (terms.get(token) ?? 0) + 1);
      length += 1;
    }
    if (length === 0) return;

    for (const term of terms.keys()) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
    }

    this.documents.push({ id: document.id, terms, length, normalized });
    this.averageLength = this.documents.reduce((total, item) => total + item.length, 0) / this.documents.length;
  }

  get size(): number {
    return this.documents.length;
  }

  /**
   * Inverse document frequency.
   *
   * The standard Robertson formula, smoothed so a term present in every
   * document scores slightly above zero rather than collapsing to negative and
   * pushing a genuinely relevant document out of the results.
   */
  private idf(term: string): number {
    const frequency = this.documentFrequency.get(term) ?? 0;
    const n = this.documents.length;
    if (frequency === 0) return 0;
    return Math.log(1 + (n - frequency + 0.5) / (frequency + 0.5));
  }

  /**
   * Ranks documents against a free-text query.
   *
   * `phraseBonus` rewards a document that contains the whole query verbatim,
   * which matters for short Arabic questions where every term is meaningful.
   */
  search(query: string, options: { limit?: number; phraseBonus?: number } = {}): Bm25Hit[] {
    const { limit = 20, phraseBonus = 1.5 } = options;
    const queryTerms = tokenizeArabic(query);
    if (!queryTerms.length || this.documents.length === 0) return [];

    const normalizedQuery = normalizeForMatch(query);
    const hits: Bm25Hit[] = [];

    for (const document of this.documents) {
      let score = 0;
      const matchedTerms: string[] = [];

      for (const term of queryTerms) {
        const frequency = document.terms.get(term);
        if (!frequency) continue;
        const idf = this.idf(term);
        if (idf <= 0) continue;

        const numerator = frequency * (K1 + 1);
        const denominator = frequency + K1 * (1 - B + (B * document.length) / (this.averageLength || 1));
        score += idf * (numerator / denominator);
        matchedTerms.push(term);
      }

      if (score <= 0) continue;

      // An exact phrase hit is a much stronger signal than scattered terms.
      if (phraseBonus > 0 && normalizedQuery.length >= 4 && document.normalized.includes(normalizedQuery)) {
        score += phraseBonus;
      }

      hits.push({ id: document.id, score, matchedTerms });
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  /**
   * Highest possible score for this index, used to normalise results onto a
   * 0-1 scale so BM25 output can be combined with a cosine similarity score.
   */
  get maxScore(): number {
    if (!this.documents.length || !this.averageLength) return 1;
    let total = 0;
    for (const term of this.documentFrequency.keys()) total += this.idf(term);
    return Math.max(total, 1);
  }
}

/**
 * Convenience builder for the common case where the caller already has an
 * array. Kept separate so the class can be reused with incremental additions if
 * that ever becomes necessary.
 */
export function buildBm25Index(documents: Bm25Document[]): Bm25Index {
  return new Bm25Index(documents);
}
