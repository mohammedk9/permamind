const FIRST_RUN_KEY = "permamind:first-run-complete:v1";

export function hasCompletedFirstRun(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(FIRST_RUN_KEY) === "1";
}

export function completeFirstRun(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FIRST_RUN_KEY, "1");
}

export function resetFirstRun(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FIRST_RUN_KEY);
}
