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

  it("keeps the room section, so a re-run cannot silently drop it", () => {
    expect(bootstrap).toContain("create table if not exists public.rooms");
    expect(bootstrap).toContain("create table if not exists public.room_members");
    expect(bootstrap).toContain("create table if not exists public.room_messages");
    expect(bootstrap).toMatch(/create policy "members read messages"/);
  });
});
