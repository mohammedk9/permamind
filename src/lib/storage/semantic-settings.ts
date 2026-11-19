/**
 * Whether the on-device semantic model is switched on.
 *
 * Stored separately from the API settings because it is not a credential or a
 * provider choice: it is a local capability the user turns on once. A single
 * boolean under its own key also means "off" is the value a fresh install reads,
 * so nobody pays a 150 MB download for a feature they never asked for.
 */

const SEMANTIC_PREFERENCE_KEY = "permamind:semantic-memory:v1";

export function loadSemanticPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SEMANTIC_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveSemanticPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(SEMANTIC_PREFERENCE_KEY, "on");
    else window.localStorage.removeItem(SEMANTIC_PREFERENCE_KEY);
  } catch {
    // A blocked store means the switch lasts for this session only, which is the
    // same outcome as leaving it off.
  }
}