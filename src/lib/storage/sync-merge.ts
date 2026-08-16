import type { Conversation, Project } from "@/types/chat";

export interface SyncMergePlan<T> {
  merged: T[];
  added: number;
  replaced: number;
  keptLocal: number;
}

function newer<T extends { id: string; updatedAt: Date; contentHash?: string }>(local: T, remote: T): "remote" | "local" {
  if (local.contentHash && remote.contentHash && local.contentHash === remote.contentHash) return "local";
  return remote.updatedAt.getTime() > local.updatedAt.getTime() ? "remote" : "local";
}

export function planConversationMerge(local: Conversation[], remote: Conversation[]): SyncMergePlan<Conversation> {
  return planMerge(local, remote, newer);
}

export function planProjectMerge(local: Project[], remote: Project[]): SyncMergePlan<Project> {
  return planMerge(local, remote, newer);
}

function planMerge<T extends { id: string; updatedAt: Date; contentHash?: string }>(
  local: T[],
  remote: T[],
  choose: (local: T, remote: T) => "remote" | "local",
): SyncMergePlan<T> {
  const byId = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let replaced = 0;
  let keptLocal = 0;

  for (const remoteItem of remote) {
    const localItem = byId.get(remoteItem.id);
    if (!localItem) {
      byId.set(remoteItem.id, remoteItem);
      added++;
    } else if (choose(localItem, remoteItem) === "remote") {
      byId.set(remoteItem.id, remoteItem);
      replaced++;
    } else {
      keptLocal++;
    }
  }

  return { merged: [...byId.values()], added, replaced, keptLocal };
}