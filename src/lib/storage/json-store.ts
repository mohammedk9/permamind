/**
 * A JSON document store with an IndexedDB backend and a synchronous facade.
 *
 * The app reads its data during render and in event handlers, so the public
 * `load()`/`save()` pair has to stay synchronous. IndexedDB is asynchronous.
 * This module bridges the two with a write-through cache:
 *
 * - `load()` is synchronous and returns the in-memory copy. On the first call
 *   before hydration it reads the legacy localStorage payload, so a render that
 *   happens before the effect runs still sees the user's data.
 * - `hydrate()` is awaited once at startup. It prefers IndexedDB, migrates a
 *   legacy localStorage payload into it, and then removes the localStorage copy
 *   so the 5 MB ceiling no longer applies to that document.
 * - `save()` updates the cache immediately and persists in the background.
 *
 * Why the cache is safe to seed from localStorage: `hydrate()` only replaces
 * the cache when IndexedDB already holds a value for the key, which means the
 * IndexedDB copy is the one written by a previous session and is at least as
 * new as anything localStorage could hold.
 */

import {
  idbDelete,
  idbGet,
  idbSet,
  isIndexedDbAvailable,
  markIndexedDbUnavailable,
} from "./idb-kv";
import { announceStorageFull, isQuotaError, persistOrAnnounce } from "./storage-health";

export type StorageBackend = "indexeddb" | "localstorage";

export interface JsonStore<T> {
  /** The localStorage key, also used as the IndexedDB key. */
  readonly key: string;
  /** Synchronous read. Returns the fallback when nothing is stored yet. */
  load(): T;
  /** Synchronous write contract: updates the cache and persists. */
  save(value: T): boolean;
  /** Loads IndexedDB into the cache. Safe to call more than once. */
  hydrate(): Promise<void>;
  /** True once `hydrate()` has completed (or been skipped). */
  isHydrated(): boolean;
  /** Which backend a write will actually use. */
  backend(): StorageBackend;
  /** Drops the cache. Tests and sign-out flows use this. */
  reset(): void;
}

export interface JsonStoreOptions<T> {
  key: string;
  /** Returned when the key holds nothing readable. */
  fallback: T;
  /** Validates a parsed value. Returning null falls back. */
  parse: (value: unknown) => T | null;
  /** Converts the in-memory value into what is persisted. Defaults to identity. */
  serialize?: (value: T) => unknown;
}

function readLegacy(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** UTF-16 code units, doubled: the browser's own accounting for strings. */
function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { key, fallback, parse, serialize } = options;

  let cache: T | null = null;
  let hydrated = false;
  let hydration: Promise<void> | null = null;

  const toPersisted = (value: T): unknown => (serialize ? serialize(value) : value);

  const readFromLegacy = (): T | null => parse(parseJson(readLegacy(key)));

  const load = (): T => {
    // IndexedDB can only be read asynchronously, so once it is the backend the
    // in-memory copy is authoritative. On the localStorage path a read is cheap
    // and always fresh, which keeps external writes and test resets visible.
    if (isIndexedDbAvailable() && cache !== null) return cache;
    const value = readFromLegacy() ?? fallback;
    if (isIndexedDbAvailable()) cache = value;
    return value;
  };

  const persistNow = (value: T): boolean => {
    const persisted = toPersisted(value);
    if (!isIndexedDbAvailable()) {
      return persistOrAnnounce(key, JSON.stringify(persisted));
    }
    void idbSet(key, persisted).catch((error: unknown) => {
      // A full IndexedDB is not a broken IndexedDB: keep using it and let the
      // banner report the failure. Only an unusable store falls back.
      const quota = isQuotaError(error);
      if (!quota) markIndexedDbUnavailable();
      announceStorageFull({ bytes: estimateBytes(persisted), quota });
    });
    return true;
  };

  const hydrate = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydration) return hydration;

    hydration = (async () => {
      if (!isIndexedDbAvailable()) {
        // Keep whatever the synchronous read produced; nothing to migrate.
        if (cache === null) cache = readFromLegacy() ?? fallback;
        hydrated = true;
        return;
      }

      try {
        const stored = await idbGet<unknown>(key);
        if (stored !== null) {
          cache = parse(stored) ?? fallback;
          hydrated = true;
          return;
        }

        // No IndexedDB copy yet: adopt the legacy payload, move it across, and
        // remove it so the same document is not counted against both quotas.
        const legacy = readLegacy(key);
        if (legacy !== null) {
          const parsed = parse(parseJson(legacy));
          if (parsed !== null) {
            cache = parsed;
            await idbSet(key, toPersisted(parsed));
            try {
              window.localStorage.removeItem(key);
            } catch {
              // A blocked localStorage leaves a redundant copy, not a wrong one.
            }
          }
        }
        if (cache === null) cache = fallback;
      } catch {
        // A blocked or corrupt IndexedDB must not take the app down: the legacy
        // payload is still readable and writes fall back to it.
        markIndexedDbUnavailable();
        if (cache === null) cache = readFromLegacy() ?? fallback;
      } finally {
        hydrated = true;
      }
    })();

    return hydration;
  };

  const save = (value: T): boolean => {
    cache = value;

    if (!isIndexedDbAvailable()) {
      return persistOrAnnounce(key, JSON.stringify(toPersisted(value)));
    }

    // A save that arrives before hydration would otherwise be overwritten by
    // the value hydration reads. Queue it instead of writing the legacy copy:
    // the whole point of the migration is that a large document never travels
    // through the 5 MB localStorage path again.
    if (!hydrated) {
      void hydrate().then(() => {
        cache = value;
        persistNow(value);
      });
      return true;
    }

    return persistNow(value);
  };

  return {
    key,
    load,
    save,
    hydrate,
    isHydrated: () => hydrated,
    backend: () => (isIndexedDbAvailable() ? "indexeddb" : "localstorage"),
    reset: () => {
      cache = null;
      hydrated = false;
      hydration = null;
      void idbDelete(key);
    },
  };
}