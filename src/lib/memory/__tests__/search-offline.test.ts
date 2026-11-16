import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMemoryRecord } from "@/lib/memory/ledger";
import { saveChatData } from "@/lib/storage/chat-storage";
import type { Conversation, Message } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

/**
 * `retrieve.ts` calls `updateMemoryGraph` while ranking. Part of what this suite
 * proves is that the offline path does not: a search triggered by a button must
 * not write to the user's storage.
 */
vi.mock("@/lib/memory/graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/graph")>();
  return { ...actual, updateMemoryGraph: vi.fn(() => new Map()) };
});

import { updateMemoryGraph } from "@/lib/memory/graph";
import {
  DEFAULT_OFFLINE_LIMIT,
  MIN_OFFLINE_QUERY_LENGTH,
  buildOfflineSnippet,
  searchMemoryOffline,
} from "../search-offline";

function message(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, content, createdAt: new Date("2026-01-01T10:00:00.000Z") };
}

function conversation(
  id: string,
  title: string,
  options: {
    messages?: Message[];
    summary?: string;
    topics?: string[];
    updatedAt?: string;
  } = {},
): Conversation {
  const updatedAt = new Date(options.updatedAt ?? "2026-01-02T00:00:00.000Z");
  return {
    id,
    title,
    messages: options.messages ?? [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt,
    ...(options.summary
      ? {
          metadata: {
            summary: options.summary,
            topics: options.topics ?? [],
            tags: [],
            entities: [],
            messageFingerprint: `${id}-fingerprint`,
            generatedAt: updatedAt,
          },
        }
      : {}),
  };
}

function decision(
  id: string,
  text: string,
  status: MemoryRecord["status"] = "active",
  conversationId = "conversation-1",
): MemoryRecord {
  return {
    id,
    kind: "decision",
    text,
    conversationId,
    conversationTitle: "Launch plan",
    confidence: "medium",
    pinned: false,
    status,
    source: "user",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...(status === "superseded" ? { supersededBy: "decision-2" } : {}),
  };
}

function seed(conversations: Conversation[], records: MemoryRecord[] = []) {
  saveChatData(conversations, null);
  for (const record of records) addMemoryRecord(record);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(updateMemoryGraph).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchMemoryOffline", () => {
  it("finds an English summary without a network call", () => {
    seed([
      conversation("c1", "Atlas launch", {
        summary: "We agreed to a staged launch: private beta first, then a public release.",
      }),
      conversation("c2", "Groceries", { summary: "Milk, bread, coffee." }),
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const hits = searchMemoryOffline("staged launch");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type).toBe("summary");
    expect(hits[0].title).toBe("Atlas launch");
    expect(hits[0].snippet).toContain("staged launch");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finds an Arabic memory written with harakat and hamza", () => {
    seed([
      conversation("c1", "خطة الإطلاق", {
        // The stored text carries harakat and a hamza-on-ya; the query does not.
        messages: [message("m1", "قَرَّرْنا أن نُؤَجِّلَ الإِطْلاقَ إلى بعد المراجعة", "assistant")],
      }),
    ]);

    const hits = searchMemoryOffline("قررنا تأجيل الإطلاق");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain("قَرَّرْنا");
  });

  it("returns nothing for a query that is too short", () => {
    seed([conversation("c1", "Launch", { summary: "launch plan" })]);

    expect(searchMemoryOffline("la")).toEqual([]);
    expect(searchMemoryOffline("  ")).toEqual([]);
    expect(MIN_OFFLINE_QUERY_LENGTH).toBe(3);
  });

  it("returns nothing when no memory matches", () => {
    seed([conversation("c1", "Groceries", { summary: "Milk and bread." })]);

    expect(searchMemoryOffline("zebra quantum")).toEqual([]);
  });

  it("returns nothing when the device holds no conversations", () => {
    expect(searchMemoryOffline("anything at all")).toEqual([]);
  });

  it("never writes the memory graph while searching", () => {
    seed([
      conversation("c1", "Atlas launch", {
        summary: "Staged launch plan.",
        messages: [message("m1", "the launch date moved", "assistant")],
      }),
    ]);

    searchMemoryOffline("launch date");

    expect(updateMemoryGraph).not.toHaveBeenCalled();
  });

  it("keeps at most the requested number of hits", () => {
    seed(
      Array.from({ length: 9 }, (_, index) =>
        conversation(`c${index}`, `Launch ${index}`, { summary: `staged launch number ${index}` }),
      ),
    );

    expect(searchMemoryOffline("staged launch")).toHaveLength(DEFAULT_OFFLINE_LIMIT);
    expect(searchMemoryOffline("staged launch", { limit: 2 })).toHaveLength(2);
    expect(searchMemoryOffline("staged launch", { limit: 0 })).toEqual([]);
  });

  it("prefers the conversation that matches most specifically", () => {
    seed([
      conversation("c1", "Groceries", { summary: "Milk, eggs, and a new frying pan." }),
      conversation("c2", "Orbit probe", {
        summary: "The orbit insertion burn was moved to Tuesday after the review.",
      }),
    ]);

    const hits = searchMemoryOffline("orbit insertion burn");

    expect(hits[0].conversationId).toBe("c2");
    // The summary excerpt, not just the title, must be reachable.
    expect(hits.some((hit) => hit.snippet.includes("orbit insertion"))).toBe(true);
  });

  it("skips the messages of the conversation the query came from", () => {
    seed([
      conversation("current", "Today", {
        summary: "A short summary about billing.",
        messages: [message("m1", "the annual billing invoice", "user")],
      }),
      conversation("other", "Old chat", {
        messages: [message("m2", "the annual billing invoice from last year", "user")],
      }),
    ]);

    const hits = searchMemoryOffline("annual billing invoice", { excludeConversationId: "current" });

    expect(hits.some((hit) => hit.snippet.includes("annual billing invoice") && hit.title === "Today")).toBe(
      false,
    );
    expect(hits[0].title).toBe("Old chat");
  });

  it("still searches the excluded conversation's summary", () => {
    seed([
      conversation("current", "Billing", {
        summary: "We compared annual billing plans.",
        messages: [message("m1", "the annual billing invoice", "user")],
      }),
    ]);

    const hits = searchMemoryOffline("annual billing", { excludeConversationId: "current" });

    expect(hits.some((hit) => hit.type === "summary")).toBe(true);
  });
});

describe("offline search over the decision ledger", () => {
  it("returns decisions with the record id and status the UI needs", () => {
    seed(
      [conversation("c1", "Launch plan")],
      [decision("d1", "Launch on Tuesday — the private beta was ready", "active", "c1")],
    );

    const hits = searchMemoryOffline("launch tuesday private beta");

    const hit = hits.find((candidate) => candidate.type === "decision");
    expect(hit).toBeDefined();
    expect(hit?.recordId).toBe("d1");
    expect(hit?.status).toBe("active");
    expect(hit?.conversationId).toBe("c1");
  });

  it("ranks active decisions ahead of the ones a later decision replaced", () => {
    seed(
      [conversation("c1", "Launch plan")],
      [
        decision("d1", "Launch on Monday — the first plan", "superseded"),
        decision("d2", "Launch on Tuesday — the beta was ready"),
      ],
    );

    const hits = searchMemoryOffline("what did we decide about the launch");

    const decisions = hits.filter((hit) => hit.type === "decision");
    expect(decisions.map((hit) => hit.recordId)).toEqual(["d2", "d1"]);
    expect(decisions.map((hit) => hit.status)).toEqual(["active", "superseded"]);
  });

  it("never surfaces a decision the user asked to forget", () => {
    seed(
      [conversation("c1", "Launch plan")],
      [
        decision("kept", "Launch on Tuesday — the private beta was ready"),
        decision("forgotten", "Launch on Tuesday — the old pricing idea", "forgotten"),
      ],
    );

    const hits = searchMemoryOffline("launch tuesday pricing");

    expect(hits.map((hit) => hit.recordId)).not.toContain("forgotten");
  });

  it("does not present facts or preferences as decisions", () => {
    seed(
      [conversation("c1", "Launch plan")],
      [
        {
          ...decision("fact-1", "Launch on Tuesday — the beta was ready"),
          id: "fact-1",
          kind: "fact",
        },
        {
          ...decision("pref-1", "Launch on Tuesday — I prefer mornings"),
          id: "pref-1",
          kind: "preference",
        },
      ],
    );

    const hits = searchMemoryOffline("launch tuesday beta");

    expect(hits.some((hit) => hit.recordId === "fact-1" || hit.recordId === "pref-1")).toBe(false);
  });

  it("reports no date for a record whose date cannot be read", () => {
    const broken = {
      ...decision("d1", "Launch on Tuesday — the beta was ready", "active", "c1"),
      updatedAt: "not a date",
    };
    seed([conversation("c1", "Launch plan")], [broken]);

    const hit = searchMemoryOffline("launch tuesday beta").find(
      (candidate) => candidate.recordId === "d1",
    );

    // Not the epoch: a date the record does not have must not be invented.
    expect(hit?.date).toBe("");
  });
});

describe("buildOfflineSnippet", () => {
  it("centres a long excerpt on the match and marks both cuts", () => {
    const text = `${"word ".repeat(40)}needle ${"other ".repeat(40)}`;

    const snippet = buildOfflineSnippet(text, ["needle"]);

    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
    expect(snippet.length).toBeLessThan(text.length);
  });

  it("keeps the original diacritics in an Arabic excerpt", () => {
    const snippet = buildOfflineSnippet("قَرَّرْنا الإِطْلاقَ بعد المراجعة", ["الاطلاق"]);

    expect(snippet).toContain("الإِطْلاقَ");
    expect(snippet.startsWith("…")).toBe(false);
  });

  it("accepts the definite article when locating the match", () => {
    const snippet = buildOfflineSnippet("ثم عدنا إلى القرار بعد يومين", ["قرار"]);

    expect(snippet).toContain("القرار");
    expect(snippet.startsWith("…")).toBe(false);
  });

  it("falls back to the opening when no word matches", () => {
    const snippet = buildOfflineSnippet("x".repeat(400), ["zzz"]);

    expect(snippet.startsWith("x")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("returns an empty excerpt for empty text", () => {
    expect(buildOfflineSnippet("", ["anything"])).toBe("");
  });
});