/**
 * In-browser semantic embeddings.
 *
 * Until now "semantic memory" was a lie: `embeddings.ts` hashes words and
 * character trigrams into 96 buckets, so `cosineSimilarity` measured shared
 * spelling, not meaning. "أجّلنا الإطلاق" and "أخّرنا النسخة" share no words and
 * therefore scored zero, however related they are.
 *
 * This module adds a real model — EmbeddingGemma (308M parameters, multilingual,
 * 2K context) — running **in the user's browser** via Transformers.js. Nothing is
 * uploaded: the model is downloaded once from Hugging Face, then every vector is
 * computed locally.
 *
 * Three deliberate properties:
 *
 * - **Opt-in and lazy.** `@huggingface/transformers` is imported inside a
 *   function, so it is absent from the first-load bundle. Nothing here runs until
 *   a caller explicitly asks for the model, and no caller does so without the
 *   user switching it on.
 * - **Degrades, never breaks.** Every function returns `null` (and callers fall
 *   back to the local embedder) when the model cannot load — a blocked download,
 *   a browser without WASM, or a machine with no memory to spare.
 * - **Truncated to 256 dimensions.** EmbeddingGemma is a Matryoshka model: the
 *   first 256 of its 768 dimensions are a valid embedding on their own, at a
 *   third of the storage and a third of the comparison cost.
 */

/** The ONNX build published for Transformers.js. */
export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

/** Matryoshka truncation: the first N dimensions are a complete embedding. */
export const EMBEDDING_DIMENSIONS = 256;

/** How many texts are embedded per call, to bound peak memory on a phone. */
const BATCH_SIZE = 8;

/** A feature-extraction pipeline, typed structurally to avoid a hard dependency. */
type FeatureExtractor = (
  texts: string[],
  options?: { pooling?: "mean"; normalize?: boolean },
) => Promise<{ data: Float32Array }>;

let extractor: FeatureExtractor | null = null;
let pending: Promise<FeatureExtractor | null> | null = null;

/** True once the model is loaded and usable in this tab. */
export function isSemanticModelLoaded(): boolean {
  return extractor !== null;
}

/**
 * Loads the model, at most once per tab.
 *
 * Resolves `false` instead of throwing: every caller treats a missing model as
 * "carry on with the local embedder", and a rejected promise would turn an
 * optional improvement into a failed request.
 */
export async function loadSemanticModel(
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  if (extractor) return true;
  if (pending) return pending.then((loaded) => loaded !== null);

  pending = (async (): Promise<FeatureExtractor | null> => {
    try {
      // Dynamic import: the library and its WASM runtime stay out of the
      // first-load bundle until this line runs.
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;

      const factory = (await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
        device: "wasm",
        // Without this, Transformers.js defaults to fp32: `model.onnx` (480 KB)
        // plus `model.onnx_data` (**1.23 GB**). `q4` selects `model_q4.onnx` +
        // `model_q4.onnx_data` (519 KB + **197 MB**), which is the difference
        // between a download a user agrees to and one they would not.
        dtype: "q4",
        progress_callback: (event: unknown) => {
          if (!onProgress) return;
          const status = (event as { status?: string }).status;
          const progress = (event as { progress?: number }).progress;
          if (status === "progress" && typeof progress === "number") {
            onProgress(Math.max(0, Math.min(1, progress / 100)));
          }
        },
      })) as unknown as FeatureExtractor;

      extractor = factory;
      return extractor;
    } catch (error) {
      console.warn("[semantic-memory] model unavailable, using the local embedder", error);
      return null;
    }
  })();

  const loaded = await pending;
  // A failed load is not cached: a transient network problem should not disable
  // the model for the rest of the session.
  if (!loaded) pending = null;
  return loaded !== null;
}

/** Drops the model and its WASM memory. The next call reloads it. */
export function unloadSemanticModel(): void {
  extractor = null;
  pending = null;
}

/**
 * Truncates to the Matryoshka width and re-normalises.
 *
 * A truncated vector is no longer unit-length, and `cosineSimilarity` assumes it
 * is — comparing it un-normalised would quietly favour long texts.
 */
function toEmbedding(vector: Float32Array): Float32Array {
  const out = new Float32Array(EMBEDDING_DIMENSIONS);
  out.set(vector.subarray(0, EMBEDDING_DIMENSIONS));

  let magnitude = 0;
  for (const value of out) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let index = 0; index < out.length; index += 1) out[index] /= magnitude;
  }
  return out;
}

/**
 * Embeds a batch of texts, or returns `null` when the model is not loaded.
 *
 * `null` rather than an empty array: a caller must be able to tell "the model
 * produced nothing" from "the model is not here", because only the second should
 * fall back to the local embedder.
 */
export async function embedSemanticTexts(texts: string[]): Promise<Float32Array[] | null> {
  const model = extractor;
  if (!model || texts.length === 0) return null;

  const vectors: Float32Array[] = [];
  try {
    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const output = await model(batch, { pooling: "mean", normalize: false });
      const width = output.data.length / batch.length;
      for (let index = 0; index < batch.length; index += 1) {
        const slice = output.data.slice(index * width, (index + 1) * width);
        if (slice.length < EMBEDDING_DIMENSIONS) continue;
        vectors.push(toEmbedding(slice));
      }
    }
  } catch (error) {
    console.warn("[semantic-memory] embedding failed", error);
    return null;
  }

  return vectors;
}

/** Embeds one text, or returns `null` when the model is not loaded. */
export async function embedSemanticText(text: string): Promise<Float32Array | null> {
  const [vector] = (await embedSemanticTexts([text])) ?? [];
  return vector ?? null;
}