export type CloudSyncMode = "local" | "supabase";

export interface StoragePreferences {
  syncMode: CloudSyncMode;
  syncConversations: boolean;
  syncMemories: boolean;
  syncProjects: boolean;
}

export const STORAGE_PREFERENCES_KEY = "permamind:storage-preferences:v1";

export const DEFAULT_STORAGE_PREFERENCES: StoragePreferences = {
  syncMode: "local",
  syncConversations: false,
  syncMemories: false,
  syncProjects: false,
};

export function loadStoragePreferences(): StoragePreferences {
  if (typeof window === "undefined") return DEFAULT_STORAGE_PREFERENCES;

  try {
    const raw = localStorage.getItem(STORAGE_PREFERENCES_KEY);
    if (!raw) return DEFAULT_STORAGE_PREFERENCES;
    const value = JSON.parse(raw) as Partial<StoragePreferences>;

    return {
      syncMode: value.syncMode === "supabase" ? "supabase" : "local",
      syncConversations: value.syncConversations === true,
      syncMemories: value.syncMemories === true,
      syncProjects: value.syncProjects === true,
    };
  } catch {
    return DEFAULT_STORAGE_PREFERENCES;
  }
}

export function saveStoragePreferences(preferences: StoragePreferences): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_PREFERENCES_KEY, JSON.stringify(preferences));
  }
}

export function isCloudSyncEnabled(preferences = loadStoragePreferences()): boolean {
  return preferences.syncMode === "supabase" && (
    preferences.syncConversations ||
    preferences.syncMemories ||
    preferences.syncProjects
  );
}