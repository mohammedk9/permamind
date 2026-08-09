const BASE_COST_PER_GIB_AR = 0.000001;

export type StorageQuote = { bytes: number; ar: number; usd: number | null; source: "arweave-network" | "fallback" };

export async function getStorageQuote(bytes: number): Promise<StorageQuote> {
  const safeBytes = Math.max(1, Math.floor(bytes));
  try {
    const response = await fetch("https://arweave.net/price/" + safeBytes, { next: { revalidate: 300 } });
    if (!response.ok) throw new Error("price unavailable");
    const winston = Number(await response.text());
    if (!Number.isFinite(winston) || winston <= 0) throw new Error("invalid price");
    return { bytes: safeBytes, ar: winston / 1e12, usd: null, source: "arweave-network" };
  } catch {
    return { bytes: safeBytes, ar: safeBytes / (1024 ** 3) * BASE_COST_PER_GIB_AR, usd: null, source: "fallback" };
  }
}