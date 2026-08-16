import type { Conversation, Project } from "@/types/chat";
import { loadChatData, saveChatData } from "./chat-storage";
import { downloadEncryptedSync } from "./sync-client";
import { planConversationMerge, planProjectMerge, type SyncMergePlan } from "./sync-merge";
import { canonicalJSON, computeContentHash } from "@/lib/arweave/dedup";

export interface SyncPreview {
  conversations: SyncMergePlan<Conversation> | null;
  projects: SyncMergePlan<Project> | null;
  cloudConversations: Conversation[];
  cloudProjects: Project[];
}

/** Reads and decrypts remote data without changing localStorage. */
export async function previewCloudSync(): Promise<SyncPreview> {
  const local = loadChatData();
  let remoteConversations;
  let remoteProjects;
  try {
    [remoteConversations, remoteProjects] = await Promise.all([
      downloadEncryptedSync<Conversation[]>("conversations"),
      downloadEncryptedSync<Project[]>("projects"),
    ]);
  } catch {
    throw new Error("لا يمكن فتح البيانات المشفرة. لا يتم حفظ كلمة المرور لدينا ولا يمكن استعادتها.");
  }

  const conversations = remoteConversations ? await addHashes(reviveDates(remoteConversations.value)) : null;
  const projects = remoteProjects ? await addHashes(reviveDates(remoteProjects.value)) : null;
  return {
    conversations: conversations ? planConversationMerge(await addHashes(local.conversations), conversations) : null,
    projects: projects ? planProjectMerge(await addHashes(local.projects), projects) : null,
    cloudConversations: conversations ?? [],
    cloudProjects: projects ?? [],
  };
}

async function addHashes<T extends { id: string }>(items: T[]): Promise<Array<T & { contentHash: string }>> {
  return Promise.all(items.map(async (item) => ({ ...item, contentHash: await computeContentHash(canonicalJSON(item)) })));
}

export function applyCloudSyncChoice(preview: SyncPreview, choice: "cloud" | "merge" | "local"): void {
  if (choice === "local") return;
  if (choice === "cloud") {
    const conversations = preview.cloudConversations;
    const projects = preview.cloudProjects;
    const local = loadChatData();
    saveChatData(conversations, conversations.some((item) => item.id === local.activeId) ? local.activeId : conversations[0]?.id ?? null, projects);
    return;
  }
  applyCloudSyncPreview(preview);
}

/** Applies an already reviewed merge plan. This is never called automatically. */
export function applyCloudSyncPreview(preview: SyncPreview): void {
  const local = loadChatData();
  const conversations = preview.conversations?.merged ?? local.conversations;
  const projects = preview.projects?.merged ?? local.projects;
  const activeId = local.activeId && conversations.some((item) => item.id === local.activeId)
    ? local.activeId
    : conversations[0]?.id ?? null;
  saveChatData(conversations, activeId, projects);
}

function reviveDates<T extends { createdAt: Date; updatedAt: Date }>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    ...("messages" in item && Array.isArray(item.messages)
      ? { messages: (item.messages as Array<{ createdAt: Date }>).map((message) => ({ ...message, createdAt: new Date(message.createdAt) })) }
      : {}),
  })) as T[];
}