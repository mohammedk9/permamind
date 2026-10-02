import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A guest has no Supabase account by design. The middleware redirects every
 * unauthenticated request on the paths it matches, so a mistake in that matcher makes
 * the whole room feature unusable in a way no unit test would otherwise catch: the page
 * loads, redirects to sign-in, and the code is never reached.
 *
 * This is asserted against the matcher itself rather than by running the middleware,
 * because the matcher is a static config export and this is the whole of its contract.
 */
const middleware = readFileSync(
  join(process.cwd(), "middleware.ts"),
  "utf8",
);

const matcherLine = middleware
  .split("\n")
  .find((line) => line.includes("matcher:"))
  ?.trim();

describe("the auth matcher does not lock guests out of a room", () => {
  it("finds the matcher, so the assertions below are not vacuous", () => {
    expect(matcherLine).toBeDefined();
    expect(matcherLine).toContain("/chat/:path*");
  });

  it("does not match the guest room path", () => {
    expect(matcherLine).not.toContain('"/r/:path*"');
    expect(matcherLine).not.toContain("/r/");
  });

  it("still protects room creation, which is a host action", () => {
    // The host row carries owner_id, a foreign key to auth.users, so creating a room
    // without a session cannot work.
    expect(matcherLine).toContain("/rooms/:path*");
  });

  it("leaves the signed-in areas alone", () => {
    for (const path of [
      "/chat/:path*",
      "/memory/:path*",
      "/backup/:path*",
      "/settings/:path*",
    ]) {
      expect(matcherLine).toContain(path);
    }
  });

  it("explains why /r is excluded, so it is not 'tidied up' later", () => {
    expect(middleware).toMatch(/`\/r\/\*` is deliberately absent/);
  });
});

describe("the guest door asks for the code rather than taking it from the URL", () => {
  const door = readFileSync(
    join(process.cwd(), "src/app/r/[roomId]/page.tsx"),
    "utf8",
  );

  it("has no search params, which is where a code in a link would live", () => {
    // A code in the URL ends up in chat logs, browser history, and the referrer of
    // every image the page loads. The field is the only place it should exist.
    expect(door).not.toContain("searchParams");
    expect(door).not.toContain("useSearchParams");
  });

  it("reads the room id from the path instead", () => {
    expect(door).toContain("useParams");
  });

  it("strips non-digits from the field, so a paste cannot smuggle anything", () => {
    expect(door).toContain('replace(/\\D/g, "")');
  });
});
