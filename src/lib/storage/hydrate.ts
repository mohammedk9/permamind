/**
 * Startup hydration for every document that lives in IndexedDB.
 *
 * Each store keeps a synchronous facade for its callers, so the data has to be
 * pulled out of IndexedDB once before the first read that matters. This runs the
 * four independent reads in parallel and is safe to call from more than one
 * component: the promise is created once and shared.
 *
 * A failure is deliberately swallowed. Every store falls back to its legacy
 * localStorage payload (or an empty document) on its own, and a blocked
 * IndexedDB must not stop the app from rendering.
 */

import { hydrateMemoryEmbeddings } from "@/lib/memory/embeddings";
import { hydrateMemoryGraph } from "@/lib/memory/graph";
import { hydrateMemoryLedger } from "@/lib/memory/ledger";
import { hydrateChatData } from "./chat-storage";

let pending: Promise<void> | null = null;

export function hydrateLocalStores(): Promise<void> {
  if (!pending) {
    pending = Promise.all([
      hydrateChatData(),
      hydrateMemoryLedger(),
      hydrateMemoryEmbeddings(),
      hydrateMemoryGraph(),
    ])
      .then(() => undefined)
      .catch(() => undefined);
  }
  return pending;
}