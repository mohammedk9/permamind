/**
 * Compression and decompression utilities for the Arweave snapshot pipeline.
 *
 * Uses the browser-native CompressionStream / DecompressionStream APIs with gzip.
 * No external dependencies required.
 *
 * Pipeline order: JSON → bytes → compress → encrypt
 * Reverse order:  decrypt → decompress → bytes → JSON
 */

import { COMPRESSION_ALGORITHM } from "./constants";

// ---------------------------------------------------------------------------
// Byte Conversion
// ---------------------------------------------------------------------------

/**
 * Serializes a JavaScript object to a UTF-8 encoded Uint8Array.
 *
 * Uses `JSON.stringify` followed by `TextEncoder` to produce a byte
 * representation suitable for compression.
 *
 * @param obj - Any JSON-serializable value.
 * @returns UTF-8 encoded bytes of the JSON string.
 *
 * @example
 * ```ts
 * const bytes = jsonToBytes({ conversations: [], version: 1 });
 * ```
 */
export function jsonToBytes(obj: unknown): Uint8Array {
  const json = JSON.stringify(obj);
  return new TextEncoder().encode(json);
}

/**
 * Deserializes a UTF-8 encoded Uint8Array back into a JavaScript object.
 *
 * Uses `TextDecoder` followed by `JSON.parse`.
 *
 * @param bytes - UTF-8 encoded bytes of a JSON string.
 * @returns The parsed JavaScript value.
 * @throws {SyntaxError} If the decoded string is not valid JSON.
 *
 * @example
 * ```ts
 * const obj = bytesToJson(bytes) as SnapshotPayload;
 * ```
 */
export function bytesToJson<T = unknown>(bytes: Uint8Array): T {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

/**
 * Reads all bytes from a ReadableStream into a single Uint8Array.
 *
 * @param stream - The readable stream to consume.
 * @returns A single Uint8Array containing all bytes from the stream.
 */
async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  // Concatenate all chunks into a single Uint8Array
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

/**
 * Compresses data using gzip via the native CompressionStream API.
 *
 * This function is used in the snapshot pipeline **before** encryption.
 * Compressing before encrypting is critical because encrypted data is
 * incompressible (high entropy), so compression must happen first to
 * reduce Arweave storage costs.
 *
 * @param data - The raw bytes to compress.
 * @returns Gzip-compressed bytes.
 * @throws {Error} If the CompressionStream API is not available.
 *
 * @example
 * ```ts
 * const raw = jsonToBytes(snapshotPayload);
 * const compressed = await compress(raw);
 * // compressed is typically 5-10x smaller for text-heavy data
 * ```
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  // Edge case: empty input — return empty output without streaming
  if (data.byteLength === 0) {
    return new Uint8Array(0);
  }

  if (typeof CompressionStream === "undefined") {
    throw new Error(
      "CompressionStream API is not available in this environment. " +
      "Requires a modern browser (Chrome 80+, Firefox 113+, Safari 16.4+)."
    );
  }

  // Create a readable stream from the input bytes
  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  // Pipe through the gzip compression stream.
  // Type assertion required because CompressionStream's writable side accepts
  // BufferSource (ArrayBuffer | ArrayBufferView) while our stream is typed as
  // ReadableStream<Uint8Array>. Uint8Array is a valid BufferSource at runtime.
  const compressedStream = inputStream.pipeThrough(
    new CompressionStream(COMPRESSION_ALGORITHM) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  );

  return readStreamToBytes(compressedStream);
}

/**
 * Decompresses gzip-compressed data using the native DecompressionStream API.
 *
 * This function is the inverse of {@link compress}. Used when restoring
 * snapshots from Arweave: decrypt → decompress → parse JSON.
 *
 * @param data - Gzip-compressed bytes.
 * @returns The original uncompressed bytes.
 * @throws {Error} If the DecompressionStream API is not available.
 * @throws {TypeError} If the input is not valid gzip data.
 *
 * @example
 * ```ts
 * const decompressed = await decompress(compressedBytes);
 * const payload = bytesToJson<SnapshotPayload>(decompressed);
 * ```
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  // Edge case: empty input — return empty output without streaming
  if (data.byteLength === 0) {
    return new Uint8Array(0);
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "DecompressionStream API is not available in this environment. " +
      "Requires a modern browser (Chrome 80+, Firefox 113+, Safari 16.4+)."
    );
  }

  // Create a readable stream from the compressed bytes
  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  // Pipe through the gzip decompression stream.
  // Type assertion required for the same reason as compress() above.
  const decompressedStream = inputStream.pipeThrough(
    new DecompressionStream(COMPRESSION_ALGORITHM) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  );

  return readStreamToBytes(decompressedStream);
}