import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A plpgsql function declared with `returns table(...)` gets one plpgsql
 * variable per output column. Any bare (unqualified) reference to a name that
 * is both an output column and a table column is then ambiguous, and
 * plpgsql.variable_conflict defaults to `error`. The function still *creates*
 * successfully, so the breakage only shows up when a client calls it. That is
 * exactly how `reserve_ai_request` shipped and returned HTTP 503 for every
 * free chat request: `column reference "reservation_id" is ambiguous`.
 *
 * These tests parse the SQL statically, so the class of bug is caught in CI
 * instead of in production.
 */

const SQL_DIR = join(__dirname, "..");
const SQL_FILES = [
  "ai-usage.sql",
  "storage-purchases.sql",
  "arweave-upload-queue.sql",
  "mcp-readonly.sql",
  "mcp-tokens.sql",
  "rooms.sql",
  "bootstrap-production.sql",
  join("migrations", "20260929000000_ai_usage.sql"),
];

interface ParsedFunction {
  name: string;
  outColumns: string[];
  body: string;
}

/** Reads a SQL file and strips comments so commented-out code is ignored. */
function readSql(name: string): string {
  return readFileSync(join(SQL_DIR, name), "utf8")
    .replace(/^﻿/, "")
    .replace(/--[^\n]*/g, "");
}

/** Splits a `returns table(a text, b uuid)` list into bare column names. */
function parseOutColumns(declaration: string): string[] {
  return declaration
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase())
    .filter((name): name is string => Boolean(name) && /^[a-z_][a-z0-9_]*$/.test(name!));
}

/** Extracts every plpgsql function body in a file with its output columns. */
function parseFunctions(sql: string): ParsedFunction[] {
  const functions: ParsedFunction[] = [];
  // `[^)]*` rather than `[\s\S]*?`: a function whose return type is not a
  // table (resolve_mcp_token) must not make the matcher backtrack across its
  // body and swallow the next function's header.
  const header =
    /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(\s*[^)]*?\s*\)\s*returns\s+table\s*\(\s*([^)]*?)\s*\)\s*language\s+plpgsql/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(sql)) !== null) {
    const start = sql.indexOf("$$", match.index);
    if (start === -1) continue;
    const end = sql.indexOf("$$", start + 2);
    if (end === -1) continue;
    functions.push({
      name: match[1],
      outColumns: parseOutColumns(match[2]),
      body: sql.slice(start + 2, end),
    });
  }
  return functions;
}

/**
 * Blanks out the positions where a bare output-column name is NOT ambiguous,
 * so the scan only sees genuine expression references:
 *   * quoted literals,
 *   * an INSERT column list, which names target columns, not expressions,
 *   * the SET target column of an UPDATE.
 */
function expressionOnly(body: string): string {
  return body
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/(insert\s+into\s+[\w.]+(?:\s+as\s+\w+)?\s*)\([^)]*\)/gi, "$1()")
    .replace(/(update\s+[\w.]+(?:\s+as\s+\w+)?\s+set\s+)(\w+)\s*=/gi, "$1# =");
}

const ALL_SQL = SQL_FILES.map((file) => ({ file, sql: readSql(file) }));

describe("plpgsql output columns are never ambiguous", () => {
  it("finds the functions that return a table, so the parser is not silently empty", () => {
    const names = ALL_SQL.flatMap(({ file, sql }) =>
      parseFunctions(sql).map((fn) => `${file}:${fn.name}`),
    );
    expect(names).toContain("ai-usage.sql:public.reserve_ai_request");
    expect(names).toContain("mcp-tokens.sql:public.issue_mcp_token");
    expect(names).toContain("mcp-tokens.sql:public.read_mcp_summaries");
  });

  it.each(ALL_SQL)("$file never returns a bare output column name", ({ file, sql }) => {
    const violations: string[] = [];

    for (const fn of parseFunctions(sql)) {
      const body = expressionOnly(fn.body);
      for (const column of fn.outColumns) {
        // A qualified reference (`alias.column`, `schema.table.column`) is
        // unambiguous and is the only form allowed to touch an output name.
        const bare = new RegExp(`(?<![.\\w])${column}(?![\\w])`, "g");
        for (const hit of body.matchAll(bare)) {
          const line = body.slice(0, hit.index).split("\n").length;
          violations.push(
            `${fn.name}: bare "${column}" at line ${line} shadows the table column; qualify it with a table alias`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the reserve path qualified, which is the fix that unblocks the ten-message allowance", () => {
    const sql = readSql("ai-usage.sql");
    expect(sql).toMatch(/insert into ai_usage_reservations as r[\s\S]*?returning r\.reservation_id into/);
    expect(sql).not.toMatch(/returning reservation_id into/);
  });
});
