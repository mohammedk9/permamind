export type PaymentNetwork = "solana" | "ethereum" | "base";
export type PaymentToken = "USDC" | "USDT";

export const PAYMENT_CONFIG = {
  solana: {
    chainId: "solana",
    address: process.env.SOLANA_PAYMENT_ADDRESS,
    rpc: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    tokens: { USDC: process.env.SOLANA_USDC_MINT, USDT: process.env.SOLANA_USDT_MINT },
    confirmations: 1,
  },
  ethereum: {
    chainId: "0x1",
    address: process.env.ETH_PAYMENT_ADDRESS,
    rpc: process.env.ETHEREUM_RPC_URL,
    tokens: { USDC: process.env.ETHEREUM_USDC_CONTRACT, USDT: process.env.ETHEREUM_USDT_CONTRACT },
    confirmations: Number(process.env.ETHEREUM_CONFIRMATIONS ?? 6),
  },
  base: {
    chainId: "0x2105",
    address: process.env.BASE_PAYMENT_ADDRESS ?? process.env.ETH_PAYMENT_ADDRESS,
    rpc: process.env.BASE_RPC_URL,
    tokens: { USDC: process.env.BASE_USDC_CONTRACT, USDT: process.env.BASE_USDT_CONTRACT },
    confirmations: Number(process.env.BASE_CONFIRMATIONS ?? 3),
  },
} as const;

export function isPaymentNetwork(value: unknown): value is PaymentNetwork { return value === "solana" || value === "ethereum" || value === "base"; }
export function isPaymentToken(value: unknown): value is PaymentToken { return value === "USDC" || value === "USDT"; }