import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import { MEMORY_LEDGER_KEY } from "@/lib/memory/ledger";
import {
  FULL_EXPORT_VERSION,
  applyImport,
  buildFullExport,
  decryptFullExport,
  planImport,
  previewImportFile,
  readEncryptedEnvelope,
  readPlainEnvelope,
  serializeEncryptedExport,
  serializePlainExport,
  validateFullExport,
  type FullExportData,
} from "@/lib/storage/full-export";
import type { Conversation, Project } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

const PASSPHRASE = "correct horse battery";

function conversation(id: string, updatedAt: string, content = "hello"): Conversation {
  const date = new Date(updatedAt);
  return {
    id,
    title: `Conversation ${id}`,
    messages: [{ id: `${id}-m1`, role: "user", content, createdAt: date }],
    createdAt: date,
    updatedAt: date,
  };
}

function project(id: string, updatedAt: string): Project {
  const date = new Date(updatedAt);
  return { id, name: `Project ${id}`, summary: "", goals: [], tasks: [], decisions: [], openQuestions: [], createdAt: date, updatedAt: date };
}

function record(id: string, updatedAt: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    kind: "fact",
    text: `Memory ${id}`,
    conversationId: "c1",
    conversationTitle: "Conversation c1",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "extracted",
    updatedAt,
    ...extra,
  };
}

function seed(conversations: Conversation[], records: MemoryRecord[] = [], projects: Project[] = []) {
  saveChatData(conversations, conversations[0]?.id ?? null, projects);
  localStorage.setItem(MEMORY_LEDGER_KEY, JSON.stringify({ version: 1, records }));
}

function fileFrom(text: string): File {
  return new File([text], "archive.json", { type: "application/json" });
}

/** jsdom's Blob has no `text()`, so the bytes are read explicitly. */
async function blobText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("full export contents", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it("captures conversations, projects, memories, and preferences", () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")], [record("r1", "2026-01-01T00:00:00Z")], [project("p1", "2026-01-01T00:00:00Z")]);

    const data = buildFullExport();

    expect(data.version).toBe(FULL_EXPORT_VERSION);
    expect(data.summary).toEqual({ conversations: 1, messages: 1, records: 1, projects: 1 });
    expect(data.conversations[0].id).toBe("c1");
    expect(data.projects[0].id).toBe("p1");
    expect(data.records[0].id).toBe("r1");
    expect(data.storagePreferences).toBeDefined();
    expect(data.storagePolicy).toBeDefined();
  });

  it("never includes the API key, which lives in sessionStorage", () => {
    sessionStorage.setItem("permamind:api-key:v1", "sk-supersecretkey123456");
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);

    const serialised = serializePlainExport(buildFullExport());

    expect(serialised).not.toContain("sk-supersecretkey123456");
    expect(serialised).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });
});

describe("plain round trip", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("survives serialise, parse, and validate", () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z", "content")], [record("r1", "2026-01-01T00:00:00Z")]);

    const parsed = JSON.parse(serializePlainExport(buildFullExport()));
    const data = validateFullExport(readPlainEnvelope(parsed).data);

    expect(data.conversations[0].messages[0].content).toBe("content");
    expect(data.records).toHaveLength(1);
  });

  it("revives dates so the app can sort and format them", () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);

    const data = validateFullExport(readPlainEnvelope(JSON.parse(serializePlainExport(buildFullExport()))).data);

    expect(data.conversations[0].createdAt).toBeInstanceOf(Date);
    expect(data.conversations[0].messages[0].createdAt).toBeInstanceOf(Date);
  });
});

describe("encrypted round trip", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("recovers the full archive with the right passphrase", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z", "secret content")], [record("r1", "2026-01-01T00:00:00Z")]);
    const data = buildFullExport();

    const blob = await serializeEncryptedExport(data, PASSPHRASE);
    const envelope = JSON.parse(await blobText(blob));

    const recovered = await decryptFullExport(readEncryptedEnvelope(envelope), PASSPHRASE);

    expect(recovered.conversations[0].messages[0].content).toBe("secret content");
    expect(recovered.records).toHaveLength(1);
    expect(recovered.summary).toEqual(data.summary);
  });

  it("rejects the wrong passphrase instead of returning garbage", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);
    const blob = await serializeEncryptedExport(buildFullExport(), PASSPHRASE);
    const envelope = JSON.parse(await blobText(blob));

    await expect(decryptFullExport(readEncryptedEnvelope(envelope), "wrong passphrase")).rejects.toThrow(
      /Could not decrypt/,
    );
  });
});

describe("validation rejects unusable archives", () => {
  beforeEach(() => localStorage.clear());

  const valid = () => ({
    version: FULL_EXPORT_VERSION,
    exportedAt: "2026-01-01T00:00:00Z",
    source: "permamind-local-export",
    conversations: [JSON.parse(JSON.stringify(conversation("c1", "2026-01-01T00:00:00Z")))],
    projects: [],
    activeId: "c1",
    records: [],
  });

  it("rejects an unsupported version", () => {
    expect(() => validateFullExport({ ...valid(), version: 99 })).toThrow(/Unsupported export version/);
  });

  it("rejects a payload with no conversations array", () => {
    expect(() => validateFullExport({ ...valid(), conversations: undefined })).toThrow(/no conversations/);
  });

  it("rejects a conversation without an id", () => {
    const broken = valid();
    delete (broken.conversations[0] as Partial<Conversation>).id;
    expect(() => validateFullExport(broken)).toThrow(/without an id/);
  });

  it("rejects a message without content", () => {
    const broken = valid();
    broken.conversations[0].messages[0] = { id: "x", role: "user", createdAt: new Date().toISOString() } as never;
    expect(() => validateFullExport(broken)).toThrow(/malformed message/);
  });

  it("rejects a malformed memory record", () => {
    expect(() => validateFullExport({ ...valid(), records: [{ id: "r1" }] })).toThrow(/malformed memory record/);
  });

  it("rejects a project without an id", () => {
    expect(() => validateFullExport({ ...valid(), projects: [{ name: "no id" }] })).toThrow(/malformed project/);
  });

  it("accepts an archive with no memory ledger yet", () => {
    const data = validateFullExport({ ...valid(), records: undefined, projects: undefined });
    expect(data.records).toEqual([]);
    expect(data.projects).toEqual([]);
  });
});

describe("merge plan", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function archive(conversations: Conversation[], records: MemoryRecord[] = []): FullExportData {
    return { ...buildFullExport(), conversations, records, activeId: conversations[0]?.id ?? null };
  }

  it("counts a brand new archive as entirely additive", () => {
    seed([conversation("local", "2026-01-01T00:00:00Z")]);
    const plan = planImport(archive([conversation("remote", "2026-02-01T00:00:00Z")], [record("r1", "2026-02-01T00:00:00Z")]));

    expect(plan.addedConversations).toBe(1);
    expect(plan.addedRecords).toBe(1);
    expect(plan.isEmpty).toBe(false);
  });

  it("prefers the newer copy of the same conversation", () => {
    seed([conversation("shared", "2026-01-01T00:00:00Z", "old")]);
    const plan = planImport(archive([conversation("shared", "2026-06-01T00:00:00Z", "new")]));

    expect(plan.replacedConversations).toBe(1);
    expect(plan.keptLocalConversations).toBe(0);
  });

  it("keeps the local copy when it is newer", () => {
    seed([conversation("shared", "2026-06-01T00:00:00Z", "new")]);
    const plan = planImport(archive([conversation("shared", "2026-01-01T00:00:00Z", "old")]));

    expect(plan.keptLocalConversations).toBe(1);
    expect(plan.replacedConversations).toBe(0);
  });

  it("reports an archive with nothing new as empty", () => {
    seed([conversation("shared", "2026-06-01T00:00:00Z")], [record("r1", "2026-01-01T00:00:00Z")]);
    const plan = planImport(archive([conversation("shared", "2026-01-01T00:00:00Z")], [record("r1", "2026-01-01T00:00:00Z")]));

    expect(plan.isEmpty).toBe(true);
  });
});

describe("applyImport", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("adds conversations that are not here yet", () => {
    seed([conversation("local", "2026-01-01T00:00:00Z")]);
    const result = applyImport({ ...buildFullExport(), conversations: [conversation("remote", "2026-02-01T00:00:00Z")], activeId: "remote" });

    expect(result.conversations).toBe(2);
    expect(loadChatData().conversations.map((item) => item.id).sort()).toEqual(["local", "remote"]);
  });

  it("never deletes a conversation that is only local", () => {
    seed([conversation("keep", "2026-01-01T00:00:00Z")]);
    applyImport({ ...buildFullExport(), conversations: [conversation("other", "2026-02-01T00:00:00Z")], activeId: "other" });

    expect(loadChatData().conversations.some((item) => item.id === "keep")).toBe(true);
  });

  it("keeps the newer local conversation over an older archive copy", () => {
    seed([conversation("shared", "2026-06-01T00:00:00Z", "local wins")]);
    applyImport({ ...buildFullExport(), conversations: [conversation("shared", "2026-01-01T00:00:00Z", "archive loses")], activeId: "shared" });

    const stored = loadChatData().conversations.find((item) => item.id === "shared")!;
    expect(stored.messages[0].content).toBe("local wins");
  });

  it("does not overwrite a memory the user corrected by hand", () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")], [record("r1", "2026-01-01T00:00:00Z", { text: "corrected by hand", source: "user" })]);

    applyImport({
      ...buildFullExport(),
      conversations: [],
      records: [record("r1", "2026-09-01T00:00:00Z", { text: "extracted from archive" })],
      activeId: null,
    });

    const stored = JSON.parse(localStorage.getItem(MEMORY_LEDGER_KEY)!).records as MemoryRecord[];
    expect(stored[0].text).toBe("corrected by hand");
  });

  it("imports memories that do not exist locally", () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);
    const result = applyImport({ ...buildFullExport(), conversations: [], records: [record("new", "2026-01-01T00:00:00Z")], activeId: null });

    expect(result.records).toBe(1);
  });
});

describe("previewImportFile", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("reads a plain archive without a passphrase", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);
    const text = serializePlainExport(buildFullExport());

    const preview = await previewImportFile(fileFrom(text));

    expect(preview.data.summary.conversations).toBe(1);
    expect(preview.plan.incomingConversations).toBe(1);
  });

  it("reports a file that is not a PermaMind export", async () => {
    await expect(previewImportFile(fileFrom(JSON.stringify({ hello: "world" })))).rejects.toThrow(
      /not a PermaMind export/,
    );
  });

  it("reports a file that is not JSON", async () => {
    await expect(previewImportFile(fileFrom("this is not json"))).rejects.toThrow(/not readable JSON/);
  });

  it("needs the passphrase for an encrypted archive", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);
    const blob = await serializeEncryptedExport(buildFullExport(), PASSPHRASE);
    const text = await blobText(blob);

    await expect(previewImportFile(fileFrom(text), "wrong one")).rejects.toThrow(/Could not decrypt/);
    await expect(previewImportFile(fileFrom(text), PASSPHRASE)).resolves.toMatchObject({
      plan: { incomingConversations: 1 },
    });
  });
});

describe("encrypted round trip, continued", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("rejects the wrong passphrase instead of returning garbage", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z")]);
    const blob = await serializeEncryptedExport(buildFullExport(), PASSPHRASE);
    const envelope = JSON.parse(await blobText(blob));

    await expect(decryptFullExport(readEncryptedEnvelope(envelope), "wrong passphrase")).rejects.toThrow(
      /Could not decrypt/,
    );
  });

  it("stores no readable plaintext in the archive", async () => {
    seed([conversation("c1", "2026-01-01T00:00:00Z", "a very distinctive sentence")]);
    const blob = await serializeEncryptedExport(buildFullExport(), PASSPHRASE);
    const text = await blobText(blob);

    expect(text).not.toContain("a very distinctive sentence");
    expect(text).not.toContain("Conversation c1");
  });

  it("refuses a passphrase that is too short", async () => {
    await expect(serializeEncryptedExport(buildFullExport(), "short")).rejects.toThrow();
  });
});
