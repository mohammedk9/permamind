"use client";

import { useEffect, useState } from "react";

type Purchase = { id: string; user_id: string; bytes: number; status: string; network: string; token: string; tx_id: string; quoted_amount: string | null };

export default function AdminStoragePage() {
  const [items, setItems] = useState<Purchase[]>([]);
  const [error, setError] = useState("");
  const [tx, setTx] = useState<Record<string, string>>({});
  const load = async () => { const response = await fetch("/api/admin/storage-purchases"); const data = await response.json(); if (!response.ok) return setError(data.error ?? "Forbidden"); setItems(data.purchases); };
  useEffect(() => { void load(); }, []);
  const confirm = async (item: Purchase) => { const response = await fetch("/api/admin/storage-purchases", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId: item.id, userId: item.user_id, arweaveTxId: tx[item.id] }) }); if (!response.ok) { const data = await response.json(); return setError(data.error ?? "Failed"); } setItems((current) => current.filter((entry) => entry.id !== item.id)); };
  return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-semibold">Arweave funding queue</h1><p className="mt-2 text-sm text-muted-foreground">Confirm only after you funded the main wallet and the upload completed. The user ID is checked server-side.</p>{error && <p className="mt-4 text-red-500">{error}</p>}<div className="mt-6 space-y-4">{items.map((item) => <div className="rounded-lg border p-4" key={item.id}><div className="text-sm">User: {item.user_id}<br />Payment: {item.network}/{item.token} — {item.quoted_amount ?? ""}<br />Bytes: {item.bytes}</div><input className="mt-3 w-full rounded border p-2" placeholder="Arweave transaction ID after upload" value={tx[item.id] ?? ""} onChange={(event) => setTx((current) => ({ ...current, [item.id]: event.target.value }))} /><button className="mt-3 rounded bg-black px-4 py-2 text-white" onClick={() => void confirm(item)}>Confirm exact user</button></div>)}</div></main>;
}