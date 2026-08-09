export const SEARCH_PER_USER_LIMIT = Number(process.env.SEARCH_PER_USER_MONTHLY_REQUEST_LIMIT) || 12;
export const SEARCH_GLOBAL_LIMIT = Number(process.env.SEARCH_GLOBAL_MONTHLY_REQUEST_LIMIT) || 1200;

export function currentSearchMonth(): string {
  return new Date().toISOString().slice(0, 7);
}