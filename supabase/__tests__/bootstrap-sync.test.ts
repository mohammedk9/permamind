import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * supabase/bootstrap-production.sql is the single script a maintainer pastes
 * into the Supabase SQL editor. Its header calls it generated, and it must stay
 * a faithful copy of the five source files. An earlier hand-assembled version
 * silently lost a closing `);`, and a later one shipped a function that
 * compiled but could never run. Both shipped to production, so the invariant is
 * asserted here instead of trusted.
 */

const SQL_DIR = join(__dirname, "..");

const SOURCES = [
  "ai-usage.sql",
  "storage-purchases.sql",
  "arweave-upload-queue.sql",
  "mcp-readonly.sql",
  "mcp-tokens.sql",
  "rooms.sql",
];

/** Normalizes line endings and trailing whitespace so sources compare cleanly. */
function normalize(sql: string): string {
  return sql
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

const bootstrap = normalize(readFileSync(join(SQL_DIR, "bootstrap-production.sql"), "utf8"));

describe("bootstrap-production.sql is a faithful copy of the SQL sources", () => {
  it.each(SOURCES)("embeds supabase/%s verbatim", (source) => {
    const original = normalize(readFileSync(join(SQL_DIR, source), "utf8"));
    expect(original.length).toBeGreaterThan(0);
    expect(bootstrap).toContain(original);
  });

  it("keeps the sources in the documented order", () => {
    const positions = SOURCES.map((source) => {
      const original = normalize(readFileSync(join(SQL_DIR, source), "utf8"));
      const index = bootstrap.indexOf(original);
      expect(index, `${source} is not embedded verbatim`).toBeGreaterThan(-1);
      return index;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("honours the safety contract the header promises", () => {
    // Checked against the executable SQL only. The header comment describes the
    // contract in prose and necessarily names the statements it forbids.
    const executable = bootstrap.replace(/--[^\n]*/g, "");
    // Additive only: no data loss, ever. `drop policy if exists` is allowed
    // because a policy is an access rule, not user data.
    expect(executable).not.toMatch(/\bdrop\s+table\b/i);
    expect(executable).not.toMatch(/\btruncate\b/i);
    expect(executable).not.toMatch(/\bdelete\s+from\b/i);
    expect(executable).not.toMatch(/\bdrop\s+column\b/i);
  });

  it("exposes every RPC the server calls", () => {
    for (const fn of [
      "reserve_ai_request",
      "finalize_ai_request",
      "release_ai_request",
      "reserve_search_request",
      "issue_mcp_token",
      "resolve_mcp_token",
      "read_mcp_summaries",
      "room_role",
      "room_is_open",
    ]) {
      expect(bootstrap, `${fn} is missing from the bootstrap script`).toContain(fn);
    }
  });

  it("stays idempotent, so re-running it in production is safe", () => {
    expect(bootstrap).toContain("create extension if not exists pgcrypto;");
    expect(bootstrap).toContain("create table if not exists public.ai_usage_daily");
    expect(bootstrap).toMatch(/create or replace function public\.reserve_ai_request/);
  });

  it("has no bare separator line, because the whole file fails to run without them", () => {
    // The script this file is generated from once wrote its `=` rules without the
    // leading `--`. Every one of them was invalid SQL, and pasting the file into the
    // Supabase editor failed immediately with:
    //
    //   ERROR: 42601: operator too long at or near "============"
    //
    // It reached production because the assertions above were about the *sources*,
    // and the sources were embedded verbatim — the file matched perfectly and still
    // could not run. This is the check that was missing.
    const bare = bootstrap
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /^=+$/.test(line) && line.length >= 20);

    expect(
      bare.map(({ number }) => number),
      "a separator line must start with '--'",
    ).toEqual([]);
  });

  it("has balanced dollar quotes, so no statement body is truncated", () => {
    // The other way this file can be unrunnable: a missing `$$` swallows everything
    // after it into a string literal, and the error then points at a random line far
    // from the cause. Every `create function` in these sources is wrapped in `$$`,
    // so an odd count means one of them lost its terminator.
    const quotes = (bootstrap.match(/\$\$/g) ?? []).length;
    expect(quotes % 2, `found ${quotes} dollar-quote markers, which is odd`).toBe(0);
    expect(quotes).toBeGreaterThan(0);
  });

  it("never drops a constraint without naming its table", () => {
    // `drop constraint` is not a statement in PostgreSQL. It exists only as
    // `ALTER TABLE … DROP CONSTRAINT`, so a line that begins with it fails to parse with
    //   ERROR: 42601: syntax error at or near "constraint"
    // which is what pasting this file into the Supabase editor produced.
    //
    // It reached production for the same reason the two checks above were written: every
    // other assertion in this file is about the *sources* being embedded faithfully, and the
    // sources matched perfectly while still being unrunnable. `DROP POLICY … ON <table>` is
    // a real standalone statement and is deliberately not matched here.
    const bare = bootstrap
      .replace(/--[^\n]*/g, "")
      .split("\n")
      .map((line, index) => ({ line: line.trim().toLowerCase(), number: index + 1 }))
      .filter(({ line }) => /^drop\s+constraint\b/.test(line));

    expect(
      bare.map(({ number }) => number),
      "use `alter table <table> drop constraint …` — `drop constraint` alone is not a statement",
    ).toEqual([]);
  });

  it("repairs host_ai_keys before any policy reads it", () => {
    // A database created by an older revision of `rooms.sql` has `owner_id` where the current
    // file says `user_id`. `create table if not exists` skips the existing table, so the repair
    // is a `do $$ … $$` block that renames the column. Its position is load-bearing: a policy
    // that reads `user_id` before the rename exists fails with
    //
    //   ERROR: 42703: column "user_id" does not exist
    //
    // which is what stopped the script on a database that had been created earlier.
    // The legacy table is recognised by its room-scoped columns and renamed aside, so the
    // assertion is on that shape rather than on a column name: the database this fixes was
    // never created from any committed revision of this file.
    const repair = bootstrap.indexOf("rename to host_ai_keys_legacy_room_scoped");
    expect(repair, "the host_ai_keys legacy repair block is missing").toBeGreaterThan(-1);
    expect(bootstrap).toContain("column_name in ('room_id', 'author_token_hash')");

    // Order is load-bearing twice over: the repair must precede the create statement, or the
    // create is a no-op against the table being renamed, and it must precede the policies.
    const create = bootstrap.indexOf("create table if not exists public.host_ai_keys");
    const firstPolicy = bootstrap.indexOf("on public.host_ai_keys for select");
    expect(
      firstPolicy,
      "no host_ai_keys policy was found, so this check would pass vacuously",
    ).toBeGreaterThan(-1);
    expect(repair, "the repair must come before the create").toBeLessThan(create);
    expect(repair, "the repair must come before the first host_ai_keys policy").toBeLessThan(
      firstPolicy,
    );
  });

  it("never drops a table to resolve a schema mismatch", () => {
    // The legacy table is renamed, not dropped. A drop would be unrecoverable and would break
    // this file's promise to stay additive — and the old rows are unreadable by any current
    // code path anyway, so nothing is gained by destroying them.
    expect(bootstrap).not.toMatch(/alter table\s+[\w.]+\s+drop\s+table\b/i);
  });

  it("pairs every dropped constraint with the table it is added to", () => {
    // The same statement written the wrong way round is still valid SQL and still wrong:
    // `alter table public.rooms drop constraint if exists room_messages_ai_has_label;`
    // parses, matches nothing because `IF EXISTS` is a no-op, and is then followed by an
    // `add constraint` that fails because the constraint still exists. Asserting the two
    // lines name the same table catches it without running a database.
    const statements = bootstrap
      .replace(/--[^\n]*/g, "")
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }));

    // Statements are accumulated up to their terminating semicolon rather than paired line by
    // line. A three-line `alter table x` / `add constraint` / `check (…)` is one statement, and
    // an earlier version of this test only rejoined a single continuation line, so the add and
    // the drop landed in different entries and the pairing test failed against correct SQL.
    const joined: string[] = [];
    let pending = "";
    let pendingFrom = 0;
    for (const { line, number } of statements) {
      if (!pending) pendingFrom = number;
      pending = pending ? `${pending} ${line}` : line;
      if (line.endsWith(";")) {
        joined.push(`/*${pendingFrom}*/ ${pending}`);
        pending = "";
      }
    }
    // Anything left over never terminated. The dollar-quote test above covers the usual cause
    // of that, so here it is simply kept rather than silently dropped.
    if (pending) joined.push(`/*${pendingFrom}*/ ${pending}`);

    const dropped = joined
      .map((text) =>
        text.match(/\/\*(\d+)\*\/\s*alter table\s+([\w.]+)\s+drop constraint\s+if exists\s+([\w]+)/i),
      )
      .filter((match): match is RegExpMatchArray => match !== null);

    // Guard against the check quietly matching nothing, which is how a test rots.
    expect(
      dropped.length,
      "no drop-constraint statements were found, so this check would pass vacuously",
    ).toBeGreaterThan(0);

    for (const [, line, table, name] of dropped) {
      const added = joined.some((text) =>
        new RegExp(
          `alter table\\s+${table.replace(".", "\\.")}\\s+add constraint\\s+${name}\\b`,
          "i",
        ).test(text),
      );
      expect(
        added,
        `constraint ${name} is dropped from ${table} on line ${line} but not re-added to it`,
      ).toBe(true);
    }
  });

  it("keeps the room section, so a re-run cannot silently drop it", () => {
    expect(bootstrap).toContain("create table if not exists public.rooms");
    expect(bootstrap).toContain("create table if not exists public.room_members");
    expect(bootstrap).toContain("create table if not exists public.room_messages");
    expect(bootstrap).toMatch(/create policy "members read messages"/);
  });
});
