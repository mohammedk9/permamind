/**
 * Vitest setup file for Arweave tests.
 * 
 * This file runs before any test files are loaded, ensuring that
 * the Web Crypto API polyfill is in place before any modules import crypto.
 */

import { webcrypto } from "node:crypto";

// Replace jsdom's incomplete crypto with Node.js's full webcrypto implementation.
// This must happen before any test imports that use crypto.subtle.
// We use direct assignment and also patch subtle specifically to ensure
// the override takes effect even if jsdom re-initializes crypto.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

// Also patch subtle directly in case crypto object is re-created
if (globalThis.crypto && globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, "subtle", {
    get() {
      return webcrypto.subtle;
    },
    configurable: true,
  });
}
