/**
 * Local semantic memory.
 *
 * Vectors are computed in the browser. Raw memory text is never sent to an
 * embedding provider, and vectors are encrypted with a device key before
 * localStorage stores them.
 */

import { normalizeForMatch } from "@/lib/i18n/arabic-normalize";

const INDEX_KEY = "permamind:memory-embeddings:v1";
const KEY_KEY = "permamind:memory-embeddings:key:v1";
const DIMENSIONS = 96;
/**
 * Bumped when the token definition changed. Vectors hashed under the old
 * normaliser cannot be compared with new ones, so the fingerprint includes the
 * model name and every stored entry is recomputed on the next sync. The key is
 * unchanged, so there is no re-encryption cost.
 */
const MODEL = "permamind-local-hashing-v2";

export interface MemoryEmbeddingDocument {
  id: string;
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "fact" | "decision" | "project";
  text: string;
  updatedAt: string;
}

interface StoredVector {
  id: string;
  conversationId: string;
  model: string;
  fingerprint: string;
  iv: string;
  vector: string;
}

interface StoredIndex { version: 1; entries: StoredVector[]; }

export interface SemanticMatch { id: string; conversationId: string; score: number; }

const cache = new Map<string, { fingerprint: string; vector: Float32Array }>();

/**
 * Hashes a normalised string into a fixed-width vector.
 *
 * The token definition comes from the shared normaliser. Before this module used
 * it, `retrieve.ts` and `embeddings.ts` each had their own copy and normalised
 * `ؤ` to `و` in one but not the other, so the lexical and semantic retrievers
 * disagreed about whether two sentences were the same text.
 */
function normalize(text: string): string {
  return normalizeForMatch(text);
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Deterministic local embedding. Similar wording lands near similar vectors. */
export function embedText(text: string): Float32Array {
  const vector = new Float32Array(DIMENSIONS);
  const words = normalize(text).split(/\s+/u).filter((token) => token.length > 1);
  for (const word of words) {
    const wordHash = hash(word);
    vector[wordHash % DIMENSIONS] += ((wordHash >>> 8) & 1) === 0 ? 1 : -1;
    if (word.length > 3) {
      for (let index = 0; index <= word.length - 3; index++) {
        const gramHash = hash(word.slice(index, index + 3));
        vector[gramHash % DIMENSIONS] += (((gramHash >>> 8) & 1) === 0 ? 0.45 : -0.45);
      }
    }
  }
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) for (let index = 0; index < vector.length; index++) vector[index] /= magnitude;
  return vector;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index++) score += left[index] * right[index];
  return score;
}

async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${MODEL}:${text}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function deviceKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(KEY_KEY);
  if (stored) return crypto.subtle.importKey("jwk", JSON.parse(stored), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  localStorage.setItem(KEY_KEY, JSON.stringify(await crypto.subtle.exportKey("jwk", created)));
  return crypto.subtle.importKey("jwk", JSON.parse(localStorage.getItem(KEY_KEY)!), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptVector(vector: Float32Array, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bytesToBase64(iv), vector: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptVector(entry: StoredVector, key: CryptoKey): Promise<Float32Array | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(entry.iv) as BufferSource },
      key,
      base64ToBytes(entry.vector) as BufferSource,
    );
    return new Float32Array(plaintext);
  } catch {
    return null;
  }
}

function readIndex(): StoredIndex {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "") as StoredIndex;
    return parsed.version === 1 && Array.isArray(parsed.entries) ? parsed : { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Refreshes changed documents and removes vectors whose source disappeared. */
export async function syncMemoryEmbeddings(documents: MemoryEmbeddingDocument[]): Promise<void> {
  if (typeof window === "undefined") return;
  // Entries hashed under a previous token definition are dropped so they get
  // recomputed. Keeping them would mix two incompatible vector spaces, which
  // silently degrades every semantic comparison after the upgrade.
  const previous = readIndex();
  const index: StoredIndex = { version: 1, entries: previous.entries.filter((entry) => entry.model === MODEL) };
  const key = await deviceKey();
  const live = new Set(documents.map((document) => document.id));
  const next: StoredVector[] = [];
  for (const document of documents) {
    const currentFingerprint = await fingerprint(document.text);
    const existing = index.entries.find((entry) => entry.id === document.id && entry.fingerprint === currentFingerprint);
    if (existing) {
      if (!cache.has(document.id)) {
        const vector = await decryptVector(existing, key);
        if (vector) cache.set(document.id, { fingerprint: currentFingerprint, vector });
      }
      next.push(existing);
      continue;
    }
    const vector = embedText(document.text);
    cache.set(document.id, { fingerprint: currentFingerprint, vector });
    next.push({
      id: document.id,
      conversationId: document.conversationId,
      model: MODEL,
      fingerprint: currentFingerprint,
      ...(await encryptVector(vector, key)),
    });
  }
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  const stored: StoredIndex = { version: 1, entries: next.filter((entry) => live.has(entry.id)) };
  localStorage.setItem(INDEX_KEY, JSON.stringify(stored));
}

export async function searchMemoryEmbeddings(query: string, limit = 4): Promise<SemanticMatch[]> {
  const queryVector = embedText(query);
  if (![...queryVector].some(Boolean)) return [];
  const index = readIndex();
  return [...cache.entries()]
    .map(([id, entry]) => ({ id, score: cosineSimilarity(queryVector, entry.vector) }))
    .filter((match) => match.score >= 0.22)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .flatMap((match) => {
      const stored = index.entries.find((entry) => entry.id === match.id);
      return stored ? [{ ...match, conversationId: stored.conversationId }] : [];
    });
}

