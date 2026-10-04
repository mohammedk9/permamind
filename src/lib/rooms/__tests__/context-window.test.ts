import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ROOM_CONTEXT_MESSAGES } from "../ai-bridge";

/**
 * The context window, and why it needed a test.
 *
 * Two files each decided how much transcript a question carries, with nothing connecting
 * them: the bridge allowed forty messages and the AI route allowed sixty. Neither was wrong on
 * its own, and every test passed, because nothing compared them.
 *
 * The failure was real and user-facing. `readMessages` serves a hundred messages, the room page
 * sent all of them, and the route's cap turned any room past sixty into a 400. "Ask the model"
 * simply stopped working once a conversation got long — and it would have been reported as a
 * provider error rather than as a bug in the client.
 *
 * These assertions are the seam. A number that appears in two places and matters to both is
 * a number that belongs in one place, and a test that keeps them honest.
 */

// `src`, reached from `src/lib/rooms/__tests__`. Two levels up: one lands in `rooms`, which is
// the mistake that made this file fail to load before any test ran.
const SRC = join(__dirname, "..", "..", "..");
const route = readFileSync(join(SRC, "app/api/rooms/ai/route.ts"), "utf8");

describe("the context window is one number, not two", () => {
  it("is bounded", () => {
    // A bound, not a preference. Every message in the window is the host's money.
    expect(ROOM_CONTEXT_MESSAGES).toBeGreaterThan(0);
    expect(ROOM_CONTEXT_MESSAGES).toBeLessThanOrEqual(100);
  });

  it("matches the cap the route enforces", () => {
    // The route cannot import the bridge — it is the server side of the isolation boundary,
    // and importing the browser module in the other direction would couple them. So the
    // number is written out and pinned here instead.
    const declared = route.match(/const MAX_MESSAGES = (\d+);/);
    expect(declared, "the route no longer declares MAX_MESSAGES").not.toBeNull();

    expect(Number(declared![1])).toBe(ROOM_CONTEXT_MESSAGES);
  });

  it("is smaller than a page of transcript, so the client actually has to slice", () => {
    // If the window were ever raised to the page size, the slice in the room page would
    // become a no-op and this bug would be reintroduced silently.
    const page = readFileSync(join(SRC, "lib/rooms/server.ts"), "utf8");
    const pageSize = Number(page.match(/const MESSAGE_PAGE = (\d+);/)![1]);

    expect(ROOM_CONTEXT_MESSAGES).toBeLessThan(pageSize);
  });

  it("keeps the room page slicing to it", () => {
    // The slice is the fix. Without it the page sends a hundred messages and the route
    // refuses, which is the exact failure this file exists to prevent.
    const roomPage = readFileSync(join(SRC, "app/r/[roomId]/page.tsx"), "utf8");

    expect(roomPage).toContain(".slice(-ROOM_CONTEXT_MESSAGES)");
  });
});