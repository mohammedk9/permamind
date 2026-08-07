import type { Conversation } from "@/types/chat";

export type StoragePolicy =
  | "store_everything"
  | "starred_only"
  | "manual_only"
  | "manual_backups_only";

export const STORAGE_POLICY_KEY = "permamind:storage-policy:v1";
export const WARNING_PREFERENCE_KEY = "permamind:permanent-memory-warning-dismissed:v1";

export const DEFAULT_STORAGE_POLICY: StoragePolicy = "store_everything";

export function conversationIncludedByPolicy(
  conversation: Conversation,
  policy: StoragePolicy,
): boolean {
  if (policy === "manual_backups_only") return false;
  if (policy === "starred_only") return conversation.starred === true;
  if (policy === "manual_only") return conversation.permanentMemory === true;
  return true;
}

export function filterConversationsByPolicy(
  conversations: Conversation[],
  policy: StoragePolicy,
): Conversation[] {
  return conversations.filter((conversation) => conversationIncludedByPolicy(conversation, policy));
}

export function loadStoragePolicy(): StoragePolicy {
  if (typeof window === "undefined") return DEFAULT_STORAGE_POLICY;
  const value = localStorage.getItem(STORAGE_POLICY_KEY);
  return value === "starred_only" || value === "manual_only" || value === "manual_backups_only"
    ? value
    : DEFAULT_STORAGE_POLICY;
}

export function saveStoragePolicy(policy: StoragePolicy): void {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_POLICY_KEY, policy);
}

export function isPermanentMemoryWarningDismissed(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(WARNING_PREFERENCE_KEY) === "true";
}

export function dismissPermanentMemoryWarning(): void {
  if (typeof window !== "undefined") localStorage.setItem(WARNING_PREFERENCE_KEY, "true");
}