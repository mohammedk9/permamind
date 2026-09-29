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
    ]) {
      expect(bootstrap, `${fn} is missing from the bootstrap script`).toContain(fn);
    }
  });

  it("stays idempotent, so re-running it in production is safe", () => {
    expect(bootstrap).toContain("create extension if not exists pgcrypto;");
    expect(bootstrap).toContain("create table if not exists public.ai_usage_daily");
    expect(bootstrap).toMatch(/create or replace function public\.reserve_ai_request/);
  });
});
