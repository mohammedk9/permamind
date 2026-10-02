import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1 of docs/group-rooms-design.md.
 *
 * These assertions are static. A live Supabase instance is not available in CI, and a
 * schema mistake here is expensive: a policy that reads as permissive to a reviewer and
 * denies everything at runtime, or one that omits the member check and lets anyone read
 * a room. Both classes of failure are invisible to a type checker and to the app, because
 * the app only ever talks to the database through a service-role route.
 */

const SQL_DIR = join(__dirname, "..");
const sql = readFileSync(join(SQL_DIR, "rooms.sql"), "utf8").replace(/^﻿/, "");
const executable = sql.replace(/--[^\n]*/g, "");

describe("rooms.sql defines every table the design needs", () => {
  it.each([
    "rooms",
    "room_members",
    "room_messages",
    "room_ideas",
    "room_votes",
  ])("creates %s", (table) => {
    expect(executable).toContain(`create table if not exists public.${table} (`);
  });

  it("enables row level security on all five", () => {
    for (const table of [
      "rooms",
      "room_members",
      "room_messages",
      "room_ideas",
      "room_votes",
    ]) {
      expect(executable).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("is idempotent, so re-running it in production is safe", () => {
    expect(executable).not.toMatch(/\bcreate table\s+public\./i);
    expect(executable).toMatch(/create table if not exists public\.rooms/);
  });

  it("never destroys data, matching the bootstrap safety contract", () => {
    // `drop policy if exists` is allowed: a policy is an access rule, not user data.
    expect(executable).not.toMatch(/\bdrop\s+table\b/i);
    expect(executable).not.toMatch(/\btruncate\b/i);
    expect(executable).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe("rooms.sql never stores plaintext content", () => {
  it("has no column for message or idea text", () => {
    // Everything a member wrote lives in `ciphertext`. A `body` or `display_name`
    // column in the clear would defeat the point of the design.
    expect(executable).not.toMatch(/\b(body|content|display_name|alias)\s+text/i);
  });

  it("stores the two codes as hashes, never as codes", () => {
    expect(executable).toContain("invite_code_hash text not null");
    expect(executable).toContain("host_code_hash text not null");
    expect(executable).not.toMatch(/\b(invite_code|host_code)\s+text\s+not\s+null/i);
  });

  it("pins the hash format, so a caller cannot store a bare token", () => {
    expect(executable).toMatch(
      /invite_code_hash text not null check \(invite_code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    );
  });

  it("stores only a wrapped key, never the room key itself", () => {
    expect(executable).toContain("wrapped_room_key text not null");
    expect(executable).not.toMatch(/\broom_key\s+text/i);
  });
});

/**
 * `host_ai_keys` is the one table here that is not room-scoped.
 *
 * A room's rows are reached with a member token, because a guest has no account. A host's
 * stored provider key is reached with an account, because it belongs to the person rather
 * than to any room — and the rules that make sense for one are wrong for the other. The
 * member-token rules are therefore applied to the room tables only, and the account rules
 * get their own assertions below.
 */
const ROOM_TABLES = ["rooms", "room_members", "room_messages", "room_ideas", "room_votes"];
const isRoomTable = (table: string) => ROOM_TABLES.includes(table);

describe("every RLS policy on a room table checks the member token", () => {
  const policies = Array.from(
    executable.matchAll(
      /create policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)\s+([\s\S]*?);/g,
    ),
  ).map((match) => ({
    name: match[1],
    table: match[2],
    operation: match[3],
    clause: match[4],
  }));

  it("parses the policies it expects, so the assertions below are not vacuous", () => {
    // If this fails the file's shape changed and the policy checks would silently
    // pass against an empty list, which is the failure mode this suite exists to avoid.
    expect(policies.length).toBeGreaterThanOrEqual(18);
    expect(policies.some((p) => p.table === "rooms")).toBe(true);
    expect(policies.some((p) => p.table === "room_messages")).toBe(true);
  });

  it("scopes the member-token rules to room tables only", () => {
    // A guard that silently stopped applying would be worse than no guard, so the filter
    // itself is asserted: it must exclude the account-owned table and include the rest.
    const keyPolicies = policies.filter((p) => p.table === "host_ai_keys");
    expect(keyPolicies.length).toBeGreaterThan(0);
    for (const policy of keyPolicies) {
      expect(isRoomTable(policy.table), `${policy.name} should not be treated as a room table`)
        .toBe(false);
    }
    expect(isRoomTable("room_messages")).toBe(true);
  });

  it("never lets a read depend on auth.uid, because a guest has no account", () => {
    // Every other table in this project keys on auth.uid(). Copying that pattern here
    // would deny every guest, silently, since no guest has a session.
    for (const policy of policies.filter((p) => p.operation === "select" && isRoomTable(p.table))) {
      expect(
        policy.clause,
        `"${policy.name}" reads on auth.uid, which no guest has`,
      ).not.toMatch(/auth\.uid\(\)/);
    }
  });

  it("requires a member check on every read policy", () => {
    for (const policy of policies.filter((p) => p.operation === "select" && isRoomTable(p.table))) {
      expect(
        policy.clause,
        `"${policy.name}" does not verify a member token`,
      ).toMatch(/room_role\(/);
    }
  });

  it("requires an open room on every read policy, so an expiry is a control", () => {
    for (const policy of policies.filter((p) => p.operation === "select" && isRoomTable(p.table))) {
      expect(
        policy.clause,
        `"${policy.name}" stays readable after the room expires`,
      ).toMatch(/room_is_open\(/);
    }
  });

  it("never checks the owner account on a message or idea policy", () => {
    // The owner is the host, but a trusted member's messages must survive a host
    // account change, and an auth.uid check here would deny all of them.
    for (const policy of policies.filter(
      (p) => p.table === "room_messages" || p.table === "room_ideas",
    )) {
      expect(
        policy.clause,
        `"${policy.name}" ties a member action to an account`,
      ).not.toMatch(/auth\.uid\(\)/);
    }
  });

  it("will not let a self-insert claim the host role", () => {
    // Joining is an insert by an unauthenticated guest. Without the role allowlist a
    // guest could insert itself as host and take the room.
    const join = policies.find((p) => p.name === "joiners add themselves");
    expect(join).toBeDefined();
    expect(join?.clause).toMatch(/role in \('guest', 'trusted'\)/);
    expect(join?.clause).not.toMatch(/'host'/);
  });

  it("restricts a voter's update to their own vote", () => {
    const update = policies.find((p) => p.name === "members change own vote");
    expect(update).toBeDefined();
    expect(update?.clause).toMatch(/voter_token_hash = public\.room_token_hash\(\)/);
    expect(update?.clause).not.toMatch(/room_role\([^)]*\)\s*=\s*'host'/);
  });

  it("allows only the host to delete a room, which deletes the transcript", () => {
    const remove = policies.find((p) => p.name === "host deletes room");
    expect(remove).toBeDefined();
    expect(remove?.clause).toMatch(/room_role\(room_id\) = 'host'/);
  });

  it("reserves updating room settings for the host", () => {
    for (const name of [
      "host updates room",
      "host manages members",
      "host pins messages",
      "host updates ideas",
    ]) {
      const policy = policies.find((p) => p.name === name);
      expect(policy, `${name} is missing`).toBeDefined();
      expect(policy?.clause).toMatch(/room_role\(room_id\) = 'host'/);
    }
  });

  it("gates a guest's first message on the room's write flag", () => {
    // Read-only is a room-wide switch, so a guest's insert has to consult the room
    // rather than its own role.
    const post = policies.find((p) => p.name === "members post messages");
    expect(post).toBeDefined();
    expect(post?.clause).toMatch(/allow_guest_write/);
  });
});

describe("rooms.sql enforces the settled decisions", () => {
  it("requires an expiry, because there is no open-ended room", () => {
    expect(executable).toMatch(/expires_at timestamptz not null/);
  });

  it("refuses a server key with no end date", () => {
    // The design rules out 'forever' for a server-side credential, and the constraint
    // is what makes that true even if the API check is bypassed.
    expect(executable).toMatch(
      /check \(key_mode = 'browser' or key_expires_at is not null\)/,
    );
  });

  it("defaults the room quota to two", () => {
    expect(executable).toMatch(/room_quota integer not null default 2/);
  });

  it("requires a display name by default", () => {
    expect(executable).toMatch(/require_display_name boolean not null default true/);
  });

  it("allows only the three roles the design defines", () => {
    expect(executable).toMatch(/role in \('host', 'trusted', 'guest'\)/);
  });

  it("keeps one vote per person per idea at the schema level", () => {
    expect(executable).toMatch(
      /primary key \(room_id, idea_id, voter_token_hash\)/,
    );
  });

  it("gives messages a total order, not just a timestamp", () => {
    expect(executable).toMatch(/seq bigint generated always as identity/);
    expect(executable).toContain(
      "create index if not exists room_messages_room_seq_idx",
    );
  });
});

describe("the realtime feed is a signal, never a channel to the data", () => {
  it("keeps the room tables out of the realtime publication", () => {
    // The single most important line in this file. Adding a room table to
    // `supabase_realtime` streams whole rows — including `author_token_hash` and
    // `wrapped_room_key` — to every subscriber, and RLS cannot save it: a guest has no
    // session and `room_token_hash()` reads a header the WebSocket handshake does not
    // carry. Broadcast is used instead and nothing is published.
    expect(executable).not.toMatch(/supabase_realtime/i);
    expect(executable).not.toMatch(/alter\s+publication/i);
  });

  it("gives each room a 128-bit feed id rather than reusing the room id", () => {
    // A room id is six characters from an alphabet chosen to be read aloud, so it is
    // guessable. Using it as a channel name would let an outsider who saw a pasted link
    // subscribe. The feed id is separate from every credential in the row.
    expect(executable).toMatch(
      /feed_id uuid not null default gen_random_uuid\(\)/,
    );
    expect(executable).toContain(
      "create unique index if not exists rooms_feed_id_idx",
    );
  });

  it("migrates an existing rooms table, because create table if not exists does not", () => {
    // Without the additive `alter table ... add column if not exists`, a room created
    // before this ran would keep working but would have no feed id, so it could never
    // receive a signal. The bootstrap is documented as additive and re-runnable.
    expect(executable).toMatch(
      /alter table public\.rooms\s+add column if not exists feed_id/,
    );
  });

  it("never puts a member token hash into a plaintext column anywhere", () => {
    // The feed is announced by the server, so if any of these reached it, a subscriber
    // could impersonate a member on the next request.
    expect(executable).not.toMatch(/feed_id\s+text/i);
    expect(executable).not.toMatch(/feed_id\s+text.*member_token/i);
  });
});

/**
 * `host_ai_keys` holds a provider key, so its rules are the mirror image of the room
 * tables': keyed on the account rather than a member token, because a guest must never be
 * able to reach it and a room host must not reach another host's.
 *
 * These are asserted separately rather than by relaxing the room-table checks, because
 * "the exception is the one table" is only trustworthy if the exception is itself pinned.
 */
describe("the stored host key is owned by an account, not by a room", () => {
  const policies = Array.from(
    executable.matchAll(
      /create policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)\s+([\s\S]*?);/g,
    ),
  ).map((match) => ({
    name: match[1],
    table: match[2],
    operation: match[3],
    clause: match[4],
  }));
  const keyPolicies = policies.filter((p) => p.table === "host_ai_keys");

  it("declares policies, so the rules below are not vacuous", () => {
    expect(keyPolicies.length).toBeGreaterThanOrEqual(4);
  });

  it("requires the owning account on every verb", () => {
    // A policy that omitted the check, or checked the wrong column, would let one account
    // read another's provider key — which is the credential behind every room it hosts.
    for (const policy of keyPolicies) {
      expect(
        policy.clause,
        `"${policy.name}" does not require the owning account`,
      ).toMatch(/auth\.uid\(\)\s*=\s*user_id/);
    }
  });

  it("never consults the room member machinery", () => {
    // A member token resolves to a role inside a room. This key belongs to an account, so a
    // token-based policy here would either deny every legitimate owner or admit every guest.
    for (const policy of keyPolicies) {
      expect(policy.clause, `"${policy.name}" checks a room membership`).not.toMatch(
        /room_role\(|room_token_hash\(|room_is_open\(/,
      );
    }
  });

  it("requires an end date, because there is no 'forever'", () => {
    expect(executable).toMatch(/expires_at timestamptz not null/);
    expect(executable).toMatch(
      /create table if not exists public\.host_ai_keys \([\s\S]*?expires_at timestamptz not null/,
    );
  });

  it("stores only ciphertext, never a key column", () => {
    // `provider_key` or a bare `key` text column would be the whole credential in one read,
    // and the envelope in `host-key.ts` would be decorative.
    expect(executable).not.toMatch(/\bprovider_key\s+text/i);
    expect(executable).not.toMatch(/host_ai_keys[\s\S]*?\bapi_key\s+text/i);
    expect(executable).toContain("sealed_dek text not null");
    expect(executable).toContain("sealed_key text not null");
  });

  it("cascades when the account is deleted, so a dead account keeps no key", () => {
    expect(executable).toMatch(
      /create table if not exists public\.host_ai_keys \([\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/,
    );
  });
});
