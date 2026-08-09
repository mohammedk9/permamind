/* eslint-disable @typescript-eslint/no-explicit-any */
import { PAYMENT_CONFIG, type PaymentNetwork, type PaymentToken } from "./config";

export type VerifiedPayment = { sender: string; amount: bigint; confirmed: boolean };
type PaymentConfig = { address?: string; rpc?: string; tokens: Record<PaymentToken, string | undefined>; confirmations: number };
const HEX = /^0x[0-9a-fA-F]+$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function verifyPayment(network: PaymentNetwork, token: PaymentToken, hash: string, expectedAmount: bigint, sender: string): Promise<VerifiedPayment> {
  const config = PAYMENT_CONFIG[network];
  if (!config.address || !config.tokens[token] || !config.rpc) throw new Error("Payment network/token is not configured");
  if (network === "solana") return verifySolana(config, token, hash, expectedAmount, sender);
  return verifyEvm(config, token, hash, expectedAmount, sender);
}

async function verifySolana(config: PaymentConfig, token: PaymentToken, hash: string, expected: bigint, sender: string): Promise<VerifiedPayment> {
  if (!SOL.test(sender) || !/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(hash)) throw new Error("Invalid Solana address or signature");
  const rpcUrl = config.rpc;
  if (!rpcUrl) throw new Error("Solana RPC is not configured");
  const response = await rpc(rpcUrl, "getTransaction", [hash, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  const tx = response?.result;
  if (!tx || tx.meta?.err) throw new Error("Solana transaction is not finalized or failed");
  const instructions = tx.transaction?.message?.instructions ?? [];
  const mint = config.tokens[token];
  const transfer = instructions.find((i: any) => i.program === "spl-token" && i.parsed?.type === "transferChecked" && i.parsed?.info?.mint === mint);
  if (!mint || !transfer || transfer.parsed.info.destination !== config.address || transfer.parsed.info.authority !== sender) throw new Error("Solana token transfer does not match this purchase");
  const amount = BigInt(transfer.parsed.info.tokenAmount.amount);
  if (amount < expected) throw new Error("Payment amount is below the quoted price");
  return { sender, amount, confirmed: true };
}

async function verifyEvm(config: PaymentConfig, token: PaymentToken, hash: string, expected: bigint, sender: string): Promise<VerifiedPayment> {
  if (!HEX.test(hash) || !HEX.test(sender)) throw new Error("Invalid EVM transaction or wallet address");
  const receipt = await rpc(config.rpc!, "eth_getTransactionReceipt", [hash]);
  if (!receipt?.result || receipt.result.status !== "0x1") throw new Error("Transaction is not confirmed or failed");
  const tx = await rpc(config.rpc!, "eth_getTransactionByHash", [hash]);
  const result = tx?.result;
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55aebf5d6f";
  const log = receipt.result.logs?.find((item: any) => item.address.toLowerCase() === config.tokens[token]!.toLowerCase() && item.topics?.[0] === transferTopic && `0x${item.topics[2].slice(26)}`.toLowerCase() === config.address!.toLowerCase());
  if (!result || result.from.toLowerCase() !== sender.toLowerCase() || result.to.toLowerCase() !== config.tokens[token]!.toLowerCase() || !log) throw new Error("EVM token transfer does not match this purchase");
  const amount = BigInt(`0x${log.data.slice(2)}`);
  if (amount < expected) throw new Error("Payment amount is below the quoted price");
  return { sender, amount, confirmed: true };
}

async function rpc(url: string, method: string, params: unknown[]) { const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store" }); if (!response.ok) throw new Error("Blockchain RPC unavailable"); return response.json(); }