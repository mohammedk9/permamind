import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The model is mocked, not downloaded: this suite is about the plumbing (lazy
 * load, failure handling, batching, Matryoshka truncation), and a real 150 MB
 * download would make it slow, flaky, and network-dependent.
 */
const pipeline = vi.fn();
const allowLocalModels = { value: true };

vi.mock("@huggingface/transformers", () => ({
  pipeline: (...args: unknown[]) => pipeline(...args),
  env: {
    get allowLocalModels() {
      return allowLocalModels.value;
    },
    set allowLocalModels(value: boolean) {
      allowLocalModels.value = value;
    },
  },
}));

import {
  EMBEDDING_DIMENSIONS,
  embedSemanticTexts,
  embedSemanticText,
  isSemanticModelLoaded,
  loadSemanticModel,
  unloadSemanticModel,
} from "../model";

/** A fake extractor returning deterministic vectors of the given width. */
function fakeExtractor(width = 768) {
  return vi.fn(async (texts: string[]) => {
    const data = new Float32Array(texts.length * width);
    for (let index = 0; index < data.length; index += 1) data[index] = ((index % 7) - 3) / 3;
    return { data };
  });
}

beforeEach(() => {
  unloadSemanticModel();
  pipeline.mockReset();
  allowLocalModels.value = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("semantic model loading", () => {
  it("is not loaded before anyone asks", () => {
    expect(isSemanticModelLoaded()).toBe(false);
  });

  it("loads once and reports progress", async () => {
    pipeline.mockResolvedValue(fakeExtractor());
    const progress: number[] = [];

    const loaded = await loadSemanticModel((fraction) => progress.push(fraction));

    expect(loaded).toBe(true);
    expect(isSemanticModelLoaded()).toBe(true);
    // The model id is what pins the weights; a typo here would download a
    // different model or fail outright. `dtype: "q4"` is what keeps the download
    // at 197 MB instead of the 1.23 GB fp32 default.
    expect(pipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "onnx-community/embeddinggemma-300m-ONNX",
      expect.objectContaining({ device: "wasm", dtype: "q4" }),
    );
  });

  it("never points the runtime at a local model folder", async () => {
    pipeline.mockResolvedValue(fakeExtractor());

    await loadSemanticModel();

    // A bundled model would mean shipping hundreds of megabytes inside the app.
    expect(allowLocalModels.value).toBe(false);
  });

  it("reuses one load for concurrent callers", async () => {
    pipeline.mockResolvedValue(fakeExtractor());

    await Promise.all([loadSemanticModel(), loadSemanticModel(), loadSemanticModel()]);

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("reports failure instead of throwing", async () => {
    pipeline.mockRejectedValue(new Error("download blocked"));
    const warn = vi.spyOn(console, "warn");

    const loaded = await loadSemanticModel();

    expect(loaded).toBe(false);
    expect(isSemanticModelLoaded()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("can try again after a failed load", async () => {
    pipeline.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(fakeExtractor());

    expect(await loadSemanticModel()).toBe(false);
    expect(await loadSemanticModel()).toBe(true);
  });

  it("unloads, and the next call loads again", async () => {
    pipeline.mockResolvedValue(fakeExtractor());
    await loadSemanticModel();

    unloadSemanticModel();
    expect(isSemanticModelLoaded()).toBe(false);

    await loadSemanticModel();
    expect(isSemanticModelLoaded()).toBe(true);
  });
});

describe("embedding", () => {
  it("returns null when no model is loaded, so callers can fall back", async () => {
    // The distinction matters: "no model" and "the model returned nothing" need
    // different handling.
    await expect(embedSemanticTexts(["a text"])).resolves.toBeNull();
    await expect(embedSemanticText("a text")).resolves.toBeNull();
  });

  it("truncates to the Matryoshka width and normalises", async () => {
    pipeline.mockResolvedValue(fakeExtractor());
    await loadSemanticModel();

    const [vector] = (await embedSemanticTexts(["a text"])) ?? [];

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);

    let magnitude = 0;
    for (const value of vector) magnitude += value * value;
    expect(Math.sqrt(magnitude)).toBeCloseTo(1, 5);
  });

  it("batches, and returns one vector per input", async () => {
    pipeline.mockResolvedValue(fakeExtractor());
    await loadSemanticModel();

    const texts = Array.from({ length: 11 }, (_, index) => `text ${index}`);
    const vectors = await embedSemanticTexts(texts);

    expect(vectors).toHaveLength(texts.length);
  });

  it("returns null when the model fails mid-batch", async () => {
    pipeline.mockResolvedValue(vi.fn(async () => {
      throw new Error("inference failed");
    }));
    await loadSemanticModel();

    await expect(embedSemanticTexts(["a text"])).resolves.toBeNull();
  });

  it("drops a vector narrower than the model's width", async () => {
    // A truncated or re-exported build must not produce short vectors that look
    // like valid embeddings.
    pipeline.mockResolvedValue(fakeExtractor(64));
    await loadSemanticModel();

    await expect(embedSemanticTexts(["a text"])).resolves.toEqual([]);
  });
});