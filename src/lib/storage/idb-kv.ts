/**
 * IndexedDB key/value layer.
 *
 * Why this exists: every conversation, the memory ledger, the embedding index,
 * and the graph used to live in localStorage. That origin is capped at roughly
 * 5 MB in Chromium, which is a few hundred messages — not a memory workspace.
 * IndexedDB is the same origin, the same offline story, and the same API shape,
 * but its quota is a large share of free disk space instead of a fixed 5 MB.
 *
 * The store is deliberately a single key/value object store rather than one
 * store per record type. The payloads are whole documents (the conversation
 * list, the ledger, the vector index), so per-record stores would add indexing
 * and migration work without making any read faster: the app always rewrites
 * the whole document anyway.
 *
 * Every function degrades instead of throwing. A browser with IndexedDB
 * disabled (private modes, blocked storage) falls back to localStorage through
 * `createJsonStore`, and an SSR render never touches `window` at all.
 */

export const IDB_DB_NAME = "permamind";
export const IDB_STORE_NAME = "kv";
export const IDB_DB_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | null = null;
let unavailable = false;

/**
 * Whether IndexedDB can be used in this environment.
 *
 * Checked on every call rather than cached as a constant because the answer
 * changes between the server render and the browser, and because a blocked
 * origin can become available again after the user changes site settings.
 */
export function isIndexedDbAvailable(): boolean {
  if (typeof window === "undefined" || unavailable) return false;
  try {
    return typeof window.indexedDB !== "undefined" && typeof window.indexedDB.open === "function";
  } catch {
    return false;
  }
}

/** Records that IndexedDB refused to open, so later calls skip the attempt. */
export function markIndexedDbUnavailable(): void {
  unavailable = true;
  databasePromise = null;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDB_STORE_NAME)) {
        database.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    // A blocked open means another tab holds an older version open. Failing is
    // correct: the caller falls back rather than guessing at a schema.
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });

  return databasePromise;
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  const transaction = database.transaction(IDB_STORE_NAME, mode);
  const request = run(transaction.objectStore(IDB_STORE_NAME));
  const result = await runRequest(request);
  // Wait for the transaction so a failed commit is reported to the caller
  // instead of surfacing later as an unhandled rejection.
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
  return result;
}

/** Reads one value. `null` means the key was never written. */
export async function idbGet<T>(key: string): Promise<T | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    const value = await withStore<T | undefined>("readonly", (store) => store.get(key));
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/** Writes one value. Throws only when the store itself is unusable. */
export async function idbSet(key: string, value: unknown): Promise<void> {
  if (!isIndexedDbAvailable()) throw new Error("IndexedDB is unavailable");
  await withStore<IDBValidKey>("readwrite", (store) => store.put(value as never, key));
}

/** Removes one key. Missing keys are not an error. */
export async function idbDelete(key: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await withStore<undefined>("readwrite", (store) => store.delete(key));
  } catch {
    // Deleting something that is not there is already the desired state.
  }
}

/**
 * The origin's real usage and quota, when the browser reports it.
 *
 * This covers IndexedDB, the service worker cache, and localStorage together,
 * which is why the storage meter uses it instead of the 5 MB localStorage
 * guess. Safari and Firefox expose it too; a browser that does not returns
 * null and the caller keeps its conservative estimate.
 */
export async function idbEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage !== "number" || typeof estimate.quota !== "number") return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}