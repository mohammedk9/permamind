/**
 * Full account export and import.
 *
 * `chat-export.ts` only carried conversations, which is not enough to rebuild a
 * workspace on another device: the memory ledger, projects, and preferences are
 * what make PermaMind feel like the same account rather than an empty app.
 *
 * This module produces one self-contained archive covering everything that
 * lives in this origin's localStorage except the embedding index, which is
 * derived data and is rebuilt from the ledger on the next sync.
 *
 * Two formats come from the same data:
 *   - a plaintext JSON file, for inspection and local-only use;
 *   - a gzip + AES-256-GCM file, for moving the archive between devices.
 *
 * Everything runs in the browser. No network call is made here, and the API key
 * is deliberately excluded so an archive can never carry a live credential.
 */

import { bytesToJson, compress, decompress, jsonToBytes } from "@/lib/arweave/compression";
import { assertPassphrase, decrypt, deriveKey, encrypt, generateSalt } from "@/lib/arweave/encryption";
import { AES_GCM_ALGORITHM_NAME, KDF_HASH, KDF_ITERATIONS, KDF_SALT_LENGTH } from "@/lib/arweave/constants";
import { loadChatData, saveChatData, type LoadedChatData } from "@/lib/storage/chat-storage";
import { MEMORY_LEDGER_KEY } from "@/lib/memory/ledger";
import { loadStoragePreferences, saveStoragePreferences, type StoragePreferences } from "@/lib/storage/storage-preferences";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";
import type { Conversation, Project } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

/** Bumped when the payload shape changes incompatibly. */
export const FULL_EXPORT_VERSION = 1;

/**
 * Safety limits mirroring the Arweave restore guards. An import replaces local
 * data, so an oversized or hostile file must be rejected before it can do that.
 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_CONVERSATIONS = 10_000;
export const MAX_IMPORT_MESSAGES = 100_000;
export const MAX_IMPORT_RECORDS = 50_000;
export const MAX_IMPORT_PROJECTS = 5_000;

export interface FullExportData {
  version: number;
  exportedAt: string;
  source: "permamind-local-export";
  conversations: Conversation[];
  projects: Project[];
  activeId: string | null;
  records: MemoryRecord[];
  storagePreferences?: StoragePreferences;
  storagePolicy?: StoragePolicy;
  summary: { conversations: number; messages: number; records: number; projects: number };
}

/** Envelope written for the encrypted variant. */
export interface EncryptedFullExport {
  format: "permamind-full-export";
  version: number;
  encrypted: true;
  compression: "gzip";
  encryption: string;
  kdf: { name: string; hash: string; iterations: number };
  /** Base64 PBKDF2 salt. */
  salt: string;
  /** Base64 AES-GCM IV. */
  iv: string;
  /** Base64 ciphertext including the GCM authentication tag. */
  ciphertext: string;
  summary: FullExportData["summary"];
}

/** Plaintext envelope used when the user does not supply a passphrase. */
export interface PlainFullExport {
  format: "permamind-full-export";
  version: number;
  encrypted: false;
  data: FullExportData;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function readLedger(): MemoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_LEDGER_KEY) ?? "null") as
      | { version?: number; records?: unknown }
      | null;
    if (!Array.isArray(parsed?.records)) return [];
    return parsed.records.filter(isRecordLike);
  } catch {
    return [];
  }
}

function isRecordLike(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MemoryRecord>;
  return typeof record.id === "string" && typeof record.text === "string" && typeof record.conversationId === "string";
}

export function countMessages(conversations: Conversation[]): number {
  return conversations.reduce(
    (total, conversation) =>
      total + conversation.messages.filter((message) => !message.isStreaming && message.content.trim()).length,
    0,
  );
}

/**
 * Collects everything worth keeping.
 *
 * The API key is never read. It lives in sessionStorage, is not part of any
 * localStorage payload, and including it would mean a backup file could carry a
 * live credential.
 */
export function buildFullExport(now = new Date()): FullExportData {
  const chat: LoadedChatData = loadChatData();
  const records = readLedger();

  return {
    version: FULL_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    source: "permamind-local-export",
    conversations: chat.conversations,
    projects: chat.projects,
    activeId: chat.activeId,
    records,
    storagePreferences: typeof window === "undefined" ? undefined : loadStoragePreferences(),
    storagePolicy: typeof window === "undefined" ? undefined : loadStoragePolicy(),
    summary: {
      conversations: chat.conversations.length,
      messages: countMessages(chat.conversations),
      records: records.length,
      projects: chat.projects.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

export function fullExportFileName(exportedAt = new Date()): string {
  return `permamind-full-${exportedAt.toISOString().replace(/[:.]/g, "-")}.pmx`;
}

export function plainExportFileName(exportedAt = new Date()): string {
  return `permamind-full-${exportedAt.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** Serialises the archive as readable JSON. */
export function serializePlainExport(data: FullExportData): string {
  const envelope: PlainFullExport = {
    format: "permamind-full-export",
    version: FULL_EXPORT_VERSION,
    encrypted: false,
    data,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Serialises the archive as gzip-compressed, AES-256-GCM encrypted bytes.
 *
 * Compression happens before encryption because ciphertext has high entropy and
 * would not compress at all; this ordering is what keeps the file small.
 */
export async function serializeEncryptedExport(data: FullExportData, passphrase: string): Promise<Blob> {
  assertPassphrase(passphrase);
  const salt = generateSalt();
  const key = await deriveKey(passphrase, salt);
  const compressed = await compress(jsonToBytes(data));
  const payload = await encrypt(compressed, key, salt);

  const envelope: EncryptedFullExport = {
    format: "permamind-full-export",
    version: FULL_EXPORT_VERSION,
    encrypted: true,
    compression: "gzip",
    encryption: AES_GCM_ALGORITHM_NAME,
    kdf: { name: "PBKDF2", hash: KDF_HASH, iterations: KDF_ITERATIONS },
    salt: payload.salt,
    iv: payload.iv,
    ciphertext: payload.ciphertext,
    summary: data.summary,
  };

  return new Blob([JSON.stringify(envelope)], { type: "application/json" });
}

/**
 * Triggers a browser download. Nothing leaves the device.
 *
 * The implementation lives in `lib/storage/download` so every export in the app
 * shares one code path; it is re-exported here because `full-export-panel`
 * already imports it from this module.
 */
export { downloadBlob } from "@/lib/storage/download";

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function isDateLike(value: unknown): boolean {
  return typeof value === "string" || value instanceof Date;
}

/**
 * Validates a decoded archive without touching storage.
 *
 * Every field is checked before a single byte is written, because an import
 * changes local conversations. Unknown extra fields are ignored so an archive
 * from a newer version still opens.
 */
export function validateFullExport(value: unknown): FullExportData {
  if (!value || typeof value !== "object") fail("Import file is not valid.");
  const data = value as Partial<FullExportData>;

  if (data.version !== FULL_EXPORT_VERSION) fail(`Unsupported export version: ${String(data.version)}.`);
  if (!Array.isArray(data.conversations)) fail("Import file has no conversations.");
  if (data.conversations.length > MAX_IMPORT_CONVERSATIONS) {
    fail("Import file has more conversations than this app accepts.");
  }
  if (Array.isArray(data.projects) && data.projects.length > MAX_IMPORT_PROJECTS) {
    fail("Import file has more projects than this app accepts.");
  }
  if (Array.isArray(data.records) && data.records.length > MAX_IMPORT_RECORDS) {
    fail("Import file has more memories than this app accepts.");
  }

  let messageCount = 0;
  for (const conversation of data.conversations) {
    if (!conversation || typeof conversation !== "object") fail("Import file has a malformed conversation.");
    const item = conversation as Partial<Conversation>;
    if (typeof item.id !== "string" || !item.id) fail("Import file has a conversation without an id.");
    if (typeof item.title !== "string") fail("Import file has a conversation without a title.");
    if (!Array.isArray(item.messages)) fail("Import file has a conversation without messages.");
    if (!isDateLike(item.createdAt) || !isDateLike(item.updatedAt)) {
      fail("Import file has a conversation without valid dates.");
    }
    for (const message of item.messages) {
      const typed = message as Partial<Conversation["messages"][number]>;
      if (!typed || typeof typed.content !== "string") fail("Import file has a malformed message.");
      if (!isDateLike(typed.createdAt)) fail("Import file has a message without a valid date.");
    }
    messageCount += item.messages.length;
    if (messageCount > MAX_IMPORT_MESSAGES) fail("Import file has more messages than this app accepts.");
  }

  if (Array.isArray(data.records) && !data.records.every(isRecordLike)) {
    fail("Import file has a malformed memory record.");
  }

  if (Array.isArray(data.projects)) {
    for (const project of data.projects) {
      if (!project || typeof project !== "object" || typeof (project as Project).id !== "string") {
        fail("Import file has a malformed project.");
      }
      if (!isDateLike((project as Project).createdAt) || !isDateLike((project as Project).updatedAt)) {
        fail("Import file has a project without valid dates.");
      }
    }
  }

  // Dates cross the JSON boundary as strings and must be revived before the app
  // sorts or formats anything with them.
  const conversations = data.conversations.map(reviveConversation);
  const projects = (data.projects ?? []).map(reviveProject);

  return {
    version: FULL_EXPORT_VERSION,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    source: "permamind-local-export",
    conversations,
    projects,
    activeId: typeof data.activeId === "string" ? data.activeId : (conversations[0]?.id ?? null),
    records: data.records ?? [],
    storagePreferences: data.storagePreferences,
    storagePolicy: data.storagePolicy,
    summary: {
      conversations: conversations.length,
      messages: countMessages(conversations),
      records: (data.records ?? []).length,
      projects: projects.length,
    },
  };
}

function reviveConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt),
    messages: conversation.messages.map((message) => ({ ...message, createdAt: new Date(message.createdAt) })),
    metadata: conversation.metadata
      ? { ...conversation.metadata, generatedAt: new Date(conversation.metadata.generatedAt) }
      : undefined,
  };
}

function reviveProject(project: Project): Project {
  return { ...project, createdAt: new Date(project.createdAt), updatedAt: new Date(project.updatedAt) };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function readEncryptedEnvelope(value: unknown): EncryptedFullExport {
  if (!value || typeof value !== "object") fail("Import file is not valid.");
  const envelope = value as Partial<EncryptedFullExport>;
  if (envelope.format !== "permamind-full-export") fail("This file is not a PermaMind export.");
  if (envelope.encrypted !== true) fail("Import file is not encrypted.");
  if (typeof envelope.ciphertext !== "string" || !envelope.ciphertext) fail("Import file has no encrypted content.");
  if (typeof envelope.iv !== "string" || typeof envelope.salt !== "string") {
    fail("Import file is missing its encryption parameters.");
  }
  if (envelope.compression !== "gzip") fail("Import file uses an unsupported compression format.");
  if (envelope.encryption !== AES_GCM_ALGORITHM_NAME) fail("Import file uses an unsupported cipher.");
  return envelope as EncryptedFullExport;
}

export function readPlainEnvelope(value: unknown): PlainFullExport {
  if (!value || typeof value !== "object") fail("Import file is not valid.");
  const envelope = value as Partial<PlainFullExport>;
  if (envelope.format !== "permamind-full-export") fail("This file is not a PermaMind export.");
  if (envelope.encrypted !== false) fail("This file is encrypted.");
  if (!envelope.data) fail("Import file has no data.");
  return envelope as PlainFullExport;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Decrypts and decompresses an archive.
 *
 * A wrong passphrase fails inside `crypto.subtle.decrypt`, because AES-GCM
 * authenticates the ciphertext. The raw error is replaced with one that says
 * what actually went wrong, since "operation failed" would leave the user
 * guessing between a typo and a damaged file.
 */
export async function decryptFullExport(envelope: EncryptedFullExport, passphrase: string): Promise<FullExportData> {
  const salt = base64ToBytes(envelope.salt);
  if (salt.byteLength !== KDF_SALT_LENGTH) fail("Import file has an invalid key salt.");
  const key = await deriveKey(passphrase, salt);

  let plaintext: Uint8Array;
  try {
    plaintext = await decrypt({ iv: envelope.iv, ciphertext: envelope.ciphertext, salt: envelope.salt }, key);
  } catch {
    fail("Could not decrypt. Check the passphrase, or the file may be damaged.");
  }

  let bytes: Uint8Array;
  try {
    bytes = await decompress(plaintext!);
  } catch {
    fail("The archive decrypted but could not be decompressed.");
  }
  return validateFullExport(bytesToJson(bytes));
}

export interface ImportPreview {
  data: FullExportData;
  plan: ImportPlan;
}

/**
 * Reads a picked file and returns a validated preview without writing anything.
 *
 * The passphrase is needed only when the file turns out to be encrypted, so the
 * plain path stays a single-step operation.
 */
/**
 * Reads a File as text.
 *
 * `File.prototype.text()` is absent in some environments the app still supports
 * (jsdom in tests, older Safari), so the FileReader path is used instead of
 * assuming the modern API exists.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsText(file);
  });
}

export async function previewImportFile(file: File, passphrase?: string): Promise<ImportPreview> {
  if (file.size > MAX_IMPORT_BYTES) fail("That file is too large to import.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFileText(file));
  } catch {
    fail("That file is not readable JSON.");
  }

  const envelope = parsed as Partial<EncryptedFullExport>;
  if (envelope?.format !== "permamind-full-export") fail("That file is not a PermaMind export.");

  const data =
    envelope.encrypted === true
      ? await decryptFullExport(readEncryptedEnvelope(envelope), passphrase ?? "")
      : validateFullExport(readPlainEnvelope(parsed).data);

  return { data, plan: planImport(data) };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface ImportPlan {
  incomingConversations: number;
  incomingMessages: number;
  incomingRecords: number;
  incomingProjects: number;
  /** Conversations that already exist locally and whose newer copy wins. */
  replacedConversations: number;
  addedConversations: number;
  keptLocalConversations: number;
  addedRecords: number;
  /** True when nothing in the file is newer than what is already here. */
  isEmpty: boolean;
}

/**
 * Works out what an import would change, before anything is written.
 *
 * The rule is last-writer-wins per item, keyed on `updatedAt`. That matches how
 * the cloud sync merge already behaves, so importing after a sync does not
 * silently roll back newer local edits.
 */
export function planImport(data: FullExportData): ImportPlan {
  const local = loadChatData();
  const localById = new Map(local.conversations.map((conversation) => [conversation.id, conversation]));
  const localProjectIds = new Set(local.projects.map((project) => project.id));
  const localRecordIds = new Set(readLedger().map((record) => record.id));

  let replacedConversations = 0;
  let addedConversations = 0;
  let keptLocalConversations = 0;
  for (const incoming of data.conversations) {
    const existing = localById.get(incoming.id);
    if (!existing) addedConversations += 1;
    else if (incoming.updatedAt.getTime() > existing.updatedAt.getTime()) replacedConversations += 1;
    else keptLocalConversations += 1;
  }

  let addedRecords = 0;
  for (const record of data.records) if (!localRecordIds.has(record.id)) addedRecords += 1;

  return {
    incomingConversations: data.conversations.length,
    incomingMessages: countMessages(data.conversations),
    incomingRecords: data.records.length,
    incomingProjects: data.projects.length,
    replacedConversations,
    addedConversations,
    keptLocalConversations,
    addedRecords,
    isEmpty:
      addedConversations === 0 &&
      replacedConversations === 0 &&
      addedRecords === 0 &&
      data.projects.every((project) => localProjectIds.has(project.id)),
  };
}

export interface ImportResult {
  conversations: number;
  messages: number;
  records: number;
  projects: number;
}

/**
 * Writes an already validated archive into local storage.
 *
 * Deliberately a merge, never a full replace: the newest copy of each item
 * wins. The one destructive path in the app stays the explicit restore
 * confirmation on the Backup page, which is a separate flow with its own review.
 */
export function applyImport(data: FullExportData): ImportResult {
  const local = loadChatData();

  const byId = new Map(local.conversations.map((conversation) => [conversation.id, conversation]));
  for (const incoming of data.conversations) {
    const existing = byId.get(incoming.id);
    if (!existing || incoming.updatedAt.getTime() > existing.updatedAt.getTime()) byId.set(incoming.id, incoming);
  }
  const conversations = [...byId.values()].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  const projectsById = new Map(local.projects.map((project) => [project.id, project]));
  for (const incoming of data.projects) {
    const existing = projectsById.get(incoming.id);
    if (!existing || incoming.updatedAt.getTime() > existing.updatedAt.getTime()) projectsById.set(incoming.id, incoming);
  }
  const projects = [...projectsById.values()];

  const activeId = local.activeId && byId.has(local.activeId) ? local.activeId : (conversations[0]?.id ?? null);
  saveChatData(conversations, activeId, projects);

  const records = mergeRecords(readLedger(), data.records);
  if (typeof window !== "undefined") {
    localStorage.setItem(MEMORY_LEDGER_KEY, JSON.stringify({ version: 1, records }));
  }

  // Preferences apply only when the archive carried them, so importing an old
  // file cannot reset a choice the user made afterwards.
  if (data.storagePreferences) saveStoragePreferences(data.storagePreferences);
  if (data.storagePolicy) saveStoragePolicy(data.storagePolicy);

  return {
    conversations: conversations.length,
    messages: countMessages(conversations),
    records: records.length,
    projects: projects.length,
  };
}

/**
 * Merges memory records with the ownership rules the app already enforces.
 *
 * A record the user edited by hand has `source: "user"`, and those are never
 * replaced by an extracted copy from an archive, exactly as `syncExtractedMemory`
 * refuses to overwrite them locally.
 */
function mergeRecords(local: MemoryRecord[], incoming: MemoryRecord[]): MemoryRecord[] {
  const byId = new Map(local.map((record) => [record.id, record]));
  for (const record of incoming) {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      continue;
    }
    if (existing.source === "user" || existing.pinned) continue;
    if (new Date(record.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) byId.set(record.id, record);
  }
  return [...byId.values()];
}
