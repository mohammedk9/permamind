"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, Eye, EyeOff, LockKeyhole, RefreshCw, RotateCcw, UploadCloud, Wallet } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StorageMeter } from "@/components/ui/storage-meter";
import { StatusPill, type Status } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversations } from "@/hooks/use-conversations";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getStorageUsage, type StorageUsage } from "@/lib/arweave/storage-quota";
import { getAllSnapshots, getLastSnapshot } from "@/lib/arweave/snapshot-registry";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";
import { getQueueStatus } from "@/lib/arweave/upload-queue";
import { restoreLatestSnapshot, restoreSnapshotByTxId, type RestoreResult } from "@/lib/arweave/restore";
import type { QueueStatusSummary } from "@/lib/arweave/snapshot-types";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import Arweave from "arweave";
import { useLocale } from "@/hooks/use-locale";

const emptyQueue: QueueStatusSummary = { total: 0, pending: 0, uploading: 0, done: 0, failed: 0, lastUploadedAt: null };
type ArweaveWalletApi = NonNullable<Window["arweaveWallet"]> & {
  disconnect?: () => Promise<void>;
  sign?: (transaction: unknown) => Promise<unknown>;
  signTransaction?: (transaction: unknown) => Promise<unknown>;
};
type SignedTransaction = typeof Arweave.prototype.transactions extends never ? never : {
  id?: string;
  signature?: string;
  reward?: string;
  [key: string]: unknown;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function queueState(queue: QueueStatusSummary, processing: boolean): { label: string; status: Status } {
  if (queue.failed > 0) return { label: "Failed", status: "error" };
  if (processing || queue.uploading > 0) return { label: "Uploading", status: "active" };
  if (queue.pending > 0) return { label: "Pending", status: "attention" };
  if (queue.done > 0) return { label: "Success", status: "success" };
  return { label: "Idle", status: "neutral" };
}

export default function BackupPage() {
  const ar = useLocale().locale === "ar";
  const conversations = useConversations();
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [policy, setPolicy] = useState<StoragePolicy>("manual_backups_only");
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [queue, setQueue] = useState<QueueStatusSummary>(emptyQueue);
  // Browser-only registry data must not be read during the initial render.
  // Reading it here makes the server render "Not created yet" while the
  // browser can immediately render an existing version, causing hydration
  // to fail.
  const [lastSnapshot, setLastSnapshot] = useState<ReturnType<typeof getLastSnapshot>>(null);
  const [confirm, setConfirm] = useState<"backup" | "restore" | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [manualTxId, setManualTxId] = useState("");
  const [browserReady, setBrowserReady] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [purchaseMb, setPurchaseMb] = useState("100");
  const [quote, setQuote] = useState<{ ar: number; source: string } | null>(null);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);
  const [purchaseWorking, setPurchaseWorking] = useState(false);
  const [paymentNetwork, setPaymentNetwork] = useState<"ethereum" | "base" | "solana">("ethereum");
  const [paymentToken, setPaymentToken] = useState<"USDC" | "USDT">("USDC");
  const [paymentTxHash, setPaymentTxHash] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const snapshot = useSnapshot(conversations.conversations, conversations.activeId, passphrase || null);

  // The backup page is also a queue-worker host. Without this processor,
  // manual backups are encrypted and persisted locally but never uploaded.
  useEffect(() => {
    if (passphrase.length >= 8) {
      startProcessor(passphrase);
    } else {
      stopProcessor();
    }

    return () => stopProcessor();
  }, [passphrase]);

  const refresh = useCallback(() => {
    setUsage(getStorageUsage());
    setQueue(getQueueStatus());
    setLastSnapshot(getLastSnapshot());
  }, []);
  const syncPurchasedQuota = useCallback(async () => {
    try {
      const response = await fetch("/api/storage/purchases", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { confirmedBytes?: number };
      const confirmedBytes = data.confirmedBytes;
      if (typeof confirmedBytes === "number" && Number.isFinite(confirmedBytes)) {
        const account = getStorageUsage();
        const { setPurchasedQuota } = await import("@/lib/arweave/storage-quota");
        setPurchasedQuota(confirmedBytes);
        setUsage(getStorageUsage({ ...account, purchasedQuotaBytes: confirmedBytes }));
      }
    } catch { /* local quota remains available if the network is unavailable */ }
  }, []);
  useEffect(() => {
    setPolicy(loadStoragePolicy());
    refresh();
    setBrowserReady(true);
    void syncPurchasedQuota();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh, syncPurchasedQuota]);
  useEffect(() => { refresh(); }, [snapshot.isProcessing, snapshot.lastSnapshotVersion, refresh]);

  const state = queueState(queue, snapshot.isProcessing);
  const latestAvailable = browserReady ? getAllSnapshots().filter((item) => item.txId).at(-1) ?? null : null;
  const lastUploadedAt = latestAvailable?.uploadedAt ?? latestAvailable?.createdAt ?? null;
  const copyTxId = async () => {
    if (!latestAvailable?.txId) return;
    await navigator.clipboard.writeText(latestAvailable.txId);
    setCopiedTxId(true);
    window.setTimeout(() => setCopiedTxId(false), 1500);
  };
  const downloadRecoveryCard = () => {
    if (!latestAvailable?.txId) return;
    const card = [
      "PermaMind recovery information",
      "",
      `Snapshot version: ${latestAvailable.version}`,
      `Arweave transaction ID: ${latestAvailable.txId}`,
      `Created: ${latestAvailable.createdAt}`,
      "",
      "How to restore:",
      "1. Open PermaMind and go to Backup.",
      "2. Enter the same backup passphrase used when this snapshot was created.",
      "3. Use Restore latest, or provide this transaction ID if manual recovery is supported.",
      "",
      "Security warning: this file does not contain your passphrase. Keep the passphrase separately.",
      "If you lose the passphrase, the encrypted backup cannot be decrypted.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([card], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `permamind-recovery-v${latestAvailable.version}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const savePolicy = (value: StoragePolicy) => { setPolicy(value); saveStoragePolicy(value); };
  const manualBackup = async () => { setConfirm(null); await snapshot.triggerSnapshot(true); refresh(); };
  const restore = async () => {
    setConfirm(null); setRestoreWorking(true); setRestoreResult(null);
    const result = await restoreLatestSnapshot({ passphrase, confirm: true });
    setRestoreResult(result); setRestoreWorking(false);
    if (result.status === "restored") conversations.reload();
  };
  const restoreManual = async () => {
    setRestoreWorking(true); setRestoreResult(null);
    const result = await restoreSnapshotByTxId({ txId: manualTxId.trim(), passphrase, confirm: true });
    setRestoreResult(result); setRestoreWorking(false);
    if (result.status === "restored") conversations.reload();
  };
  const percentage = usage?.percentageUsed ?? 0;
  const quotaStatus: Status = percentage >= 100 ? "error" : percentage >= 80 ? "attention" : "success";
  const connectWallet = async () => {
    try {
      if (!window.arweaveWallet) throw new Error("Install ArConnect to connect an Arweave wallet.");
      await window.arweaveWallet.connect(["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "SIGN_TRANSACTION"]);
      const address = await window.arweaveWallet.getActiveAddress();
      if (!address) throw new Error("The wallet did not return an active address.");
      setWalletAddress(address);
      setPurchaseMessage(null);
      return address;
    } catch (error) {
      setPurchaseMessage(error instanceof Error ? `Wallet connection failed: ${error.message}` : "Wallet connection failed.");
      return null;
    }
  };
  const disconnectWallet = async () => {
    try {
      const wallet = window.arweaveWallet as ArweaveWalletApi | undefined;
      if (wallet?.disconnect) await wallet.disconnect();
      setWalletAddress(null);
      setPurchaseMessage("Wallet disconnected from PermaMind.");
    } catch (error) {
      setPurchaseMessage(error instanceof Error ? `Could not disconnect wallet: ${error.message}` : "Could not disconnect wallet.");
    }
  };
  const connectEthereum = async () => {
    const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
    if (!ethereum) return setPurchaseMessage("MetaMask was not found in this browser.");
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts[0]) throw new Error("MetaMask returned no account.");
      setEthAddress(accounts[0]);
      setPurchaseMessage("Ethereum wallet connected. AR payment is still required for this storage plan.");
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : "Ethereum wallet connection failed."); }
  };
  const connectSolana = async () => {
    const solana = (window as Window & { solana?: { connect: () => Promise<{ publicKey?: { toString: () => string } }> } }).solana;
    if (!solana) return setPurchaseMessage("A Solana wallet such as Phantom was not found in this browser.");
    try {
      const result = await solana.connect();
      const address = result.publicKey?.toString();
      if (!address) throw new Error("Solana wallet returned no public key.");
      setSolanaAddress(address);
      setPurchaseMessage("Solana wallet connected. AR payment is still required for this storage plan.");
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : "Solana wallet connection failed."); }
  };
  const loadQuote = async () => {
    const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
    if (!Number.isFinite(bytes) || bytes < 1) return setPurchaseMessage("Enter a valid storage amount.");
    const response = await fetch(`/api/storage/quote?bytes=${bytes}`);
    const data = await response.json() as { ar?: number; source?: string; error?: string };
    if (!response.ok) return setPurchaseMessage(data.error ?? "Could not calculate price");
    setQuote({ ar: data.ar ?? 0, source: data.source ?? "fallback" });
  };
  const purchaseStorage = async () => {
    setPurchaseWorking(true); setPurchaseMessage(null);
    try {
      const address = walletAddress ?? await connectWallet();
      if (!address || !window.arweaveWallet) throw new Error("Connect ArConnect first.");
      const paymentAddress = process.env.NEXT_PUBLIC_STORAGE_PAYMENT_ADDRESS;
      if (!paymentAddress) throw new Error("Storage payments are not configured by the administrator.");
      if (!/^[A-Za-z0-9_-]{43}$/.test(paymentAddress)) {
        throw new Error("The administrator payment address is not a valid 43-character Arweave address.");
      }
      const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
      const pricing = quote ?? (await (await fetch(`/api/storage/quote?bytes=${bytes}`)).json() as { ar: number });
      const quantity = Math.ceil(pricing.ar * 1e12);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Invalid payment amount.");
      // Build a real Arweave transaction first. ArConnect signs this object
      // without exposing the user's private key; dispatch is intentionally not
      // used because its payload contract differs between extension versions.
      const wallet = window.arweaveWallet as ArweaveWalletApi;
      const arweave = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
      const transaction = await arweave.createTransaction({ target: paymentAddress, quantity: String(quantity), data: "" });
      transaction.addTag("App-Name", "PermaMind");
      transaction.addTag("Action", "Storage-Purchase");
      const sign = wallet.signTransaction ?? wallet.sign;
      if (!sign) throw new Error("This wallet does not expose an Arweave signing method. Update ArConnect.");
      const signed = await sign.call(wallet, transaction) as SignedTransaction | undefined;
      const finalTransaction = (signed ?? transaction) as typeof transaction & SignedTransaction;
      if (!finalTransaction.id || !finalTransaction.signature) throw new Error("Wallet returned an unsigned transaction.");
      const responseFromNetwork = await arweave.transactions.post(finalTransaction);
      if (responseFromNetwork.status < 200 || responseFromNetwork.status >= 300) {
        throw new Error(`Arweave rejected the payment (HTTP ${responseFromNetwork.status}).`);
      }
      const txId = finalTransaction.id;
      if (!txId) throw new Error("Wallet did not return a transaction ID.");
      const response = await fetch("/api/storage/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes, walletAddress: address, txId }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Purchase registration failed");
      setPurchaseMessage("Payment submitted. Storage will be activated after network confirmation.");
      window.setTimeout(() => void syncPurchasedQuota(), 15_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPurchaseMessage(message ? `Purchase failed: ${message}` : "Purchase failed. Check the wallet extension.");
    }
    finally { setPurchaseWorking(false); }
  };
  const registerTokenPayment = async () => {
    setPurchaseWorking(true); setPurchaseMessage(null);
    try {
      const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
      const response = await fetch("/api/storage/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes, walletAddress: paymentNetwork === "solana" ? solanaAddress : ethAddress, txId: paymentTxHash, network: paymentNetwork, token: paymentToken, tokenAmount }) });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Payment verification failed");
      setPurchaseMessage(data.message ?? "Payment verified. Arweave processing is pending.");
      void syncPurchasedQuota();
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : "Payment registration failed"); }
    finally { setPurchaseWorking(false); }
  };

  return <AppShell activeArea="backup" onNavigate={(area) => { window.location.href = `/${area}`; }}>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader eyebrow={ar ? "نسخ احتياطي اختياري" : "Optional encrypted backup"} title={ar ? "مركز النسخ الاحتياطي" : "Backup Center"} description={ar ? "تبقى محادثاتك محلياً افتراضياً. اختر يدوياً ما تريد تشفيره ورفعه إلى Arweave." : "Your conversations stay local by default. Manually choose what to encrypt and upload to Arweave."} />
        <SurfaceCard title={ar ? "كيف تحمي بياناتك؟" : "How your recovery works"} description={ar ? "شرح بسيط قبل البدء" : "A simple explanation before you start"}>
          <div className="space-y-2 text-sm"><p>{ar ? "تبقى محادثاتك محلياً ولا يتم رفعها تلقائياً. عند اختيار نسخة احتياطية، نشفّرها داخل متصفحك قبل رفعها. Arweave يحفظ النسخة المشفرة ولا يستطيع قراءة محتواها." : "Your conversations remain local and are not uploaded automatically. When you choose a backup, it is encrypted in this browser before upload. Arweave stores the encrypted copy and cannot read it."}</p><p>{ar ? "الحذف المحلي لا يحذف النسخة المرفوعة: إذا حذفت محادثة من هذا الجهاز فقد تبقى نسختها المشفرة بشكل دائم على Arweave." : "Delete locally does not delete an uploaded backup: if you delete a conversation from this device, its encrypted copy may remain permanently on Arweave."}</p><p className="font-medium text-status-attention">{ar ? "لا تحفظ عبارة المرور في المتصفح أو في بطاقة الاستعادة. فقدانها يعني فقدان القدرة على فك النسخة." : "Do not rely on the browser or recovery card to store your passphrase. Losing it means the encrypted backup cannot be decrypted."}</p></div>
        </SurfaceCard>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <SurfaceCard title={ar ? "نظرة عامة على النسخ الاحتياطي" : "Backup overview"} description={ar ? "تبقى المحادثات المحلية متاحة حتى عند انتظار النسخ أو عدم توفره." : "Local conversations remain available even when a backup is queued or unavailable."} actions={<StatusPill status={state.status} label={state.label} />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-caption">Current snapshot</p><p className="mt-1 text-lg font-semibold">{lastSnapshot ? `Version ${lastSnapshot.version}` : "Not created yet"}</p></div>
              <div><p className="text-caption">Last successful upload</p><p className="mt-1 font-medium">{formatDate(lastUploadedAt)}</p></div>
              <div><p className="text-caption">Conversations ready</p><p className="mt-1 font-medium">{conversations.conversations.length}</p></div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button onClick={() => setConfirm("backup")} disabled={!passphrase || snapshot.isProcessing} aria-label={ar ? "إنشاء نسخة احتياطية مشفرة يدويًا" : "Create a manual encrypted backup"}><UploadCloud className="size-4" />{snapshot.isProcessing ? (ar ? "جارٍ إنشاء النسخة…" : "Creating backup…") : (ar ? "نسخ احتياطي الآن" : "Back up now")}</Button>
              <Button variant="outline" onClick={() => setConfirm("restore")} disabled={!passphrase || !latestAvailable || restoreWorking} aria-label={ar ? "استعادة أحدث نسخة احتياطية" : "Restore the latest backup"}><RotateCcw className="size-4" />{ar ? "استعادة الأحدث" : "Restore latest"}</Button>
            </div>
            <div className="sr-only" aria-live="polite">{snapshot.isProcessing ? "Backup is in progress" : restoreWorking ? "Restore is in progress" : restoreResult?.message ?? ""}</div>
          </SurfaceCard>

          <SurfaceCard title={ar ? "استخدام التخزين" : "Storage usage"} description={ar ? "الحصة المجانية: 15 ميجابايت. الحد الأقصى للرفع الفردي 50 ميجابايت." : "Free quota: 15 MB. Each individual upload can be up to 50 MB; paid quota applies after the free allowance."}>
            {usage && <StorageMeter used={`${usage.usedMb.toFixed(2)} MB`} total={`${(usage.freeQuotaBytes / 1024 / 1024).toFixed(0)} MB quota`} percentage={quotaStatus === "success" && usage.purchasedQuotaBytes > 0 ? Math.min(100, usage.usedBytes / usage.freeQuotaBytes * 100) : usage.percentageUsed} status={quotaStatus} />}
            {usage && usage.purchasedQuotaBytes > 0 && <p className="mt-2 text-xs text-muted-foreground">Paid storage added: {(usage.purchasedQuotaBytes / 1024 / 1024).toFixed(0)} MB</p>}
            {usage && usage.percentageUsed >= 80 && <p className="mt-4 text-sm text-status-attention">{usage.percentageUsed >= 100 ? "Storage is full. New uploads may be blocked; local conversations are not deleted." : "Storage is nearly full. Review usage before creating more backups."}</p>}
          </SurfaceCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SurfaceCard title="Buy more permanent storage" description="The price is calculated from the current Arweave network price. Payment requires an Arweave wallet.">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void connectWallet()}><Wallet className="size-4" />{walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Connect ArConnect"}</Button>
              {walletAddress && <Button variant="outline" onClick={() => void disconnectWallet()}>Disconnect wallet</Button>}
              <Button variant="outline" onClick={() => void connectEthereum()}>{ethAddress ? `MetaMask ${ethAddress.slice(0, 6)}…` : "Connect MetaMask"}</Button>
              <Button variant="outline" onClick={() => void connectSolana()}>{solanaAddress ? `Solana ${solanaAddress.slice(0, 6)}…` : "Connect Solana"}</Button>
              <Button variant="outline" onClick={() => { setPurchaseMb("100"); void loadQuote(); }}>100 MB</Button>
            </div>
            <label htmlFor="purchase-storage" className="mt-4 block text-label">Custom amount (MB)</label>
            <div className="mt-2 flex gap-2"><Input id="purchase-storage" type="number" min="1" step="1" value={purchaseMb} onChange={(event) => setPurchaseMb(event.target.value)} /><Button variant="outline" onClick={() => void loadQuote()}>Get price</Button></div>
            {quote && <p className="mt-3 text-sm">Estimated price: <strong>{quote.ar.toFixed(9)} AR</strong> <span className="text-caption">({quote.source === "arweave-network" ? "live network price" : "fallback estimate"})</span></p>}
            <Button className="mt-3" onClick={() => void purchaseStorage()} disabled={purchaseWorking || !quote}><Wallet className="size-4" />{purchaseWorking ? "Submitting…" : "Pay and request storage"}</Button>
            <div className="mt-5 border-t pt-4">
              <p className="text-label">Pay with a stablecoin</p>
              <p className="mt-1 text-caption">Send the exact quoted token amount to the configured address, then submit the transaction hash. Gas is paid separately by your wallet.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <select className="rounded-md border bg-background p-2 text-sm" value={paymentNetwork} onChange={(e) => setPaymentNetwork(e.target.value as typeof paymentNetwork)}><option value="ethereum">Ethereum</option><option value="base">Base</option><option value="solana">Solana</option></select>
                <select className="rounded-md border bg-background p-2 text-sm" value={paymentToken} onChange={(e) => setPaymentToken(e.target.value as typeof paymentToken)}><option>USDC</option><option>USDT</option></select>
                <Input placeholder="Token amount (smallest units)" value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} inputMode="numeric" />
              </div>
              <Input className="mt-2" placeholder="Transaction hash/signature" value={paymentTxHash} onChange={(e) => setPaymentTxHash(e.target.value)} />
              <Button className="mt-2" variant="outline" onClick={() => void registerTokenPayment()} disabled={purchaseWorking || !paymentTxHash || !tokenAmount || (paymentNetwork === "solana" ? !solanaAddress : !ethAddress)}>Verify stablecoin payment</Button>
            </div>
            {purchaseMessage && <p className="mt-3 text-sm text-status-attention" role="status">{purchaseMessage}</p>}
            <p className="mt-3 text-caption">USDC/USDT verification is server-side. After verification, Arweave permanent-storage processing may take time.</p>
          </SurfaceCard>
          <SurfaceCard title="Backup policy" description="Choose which existing conversations the snapshot pipeline includes automatically.">
            <label htmlFor="backup-policy" className="text-label">Permanent storage policy</label>
            <select id="backup-policy" className="mt-2 w-full rounded-md border bg-background p-2.5 text-sm" value={policy} onChange={(event) => savePolicy(event.target.value as StoragePolicy)}>
              <option value="store_everything">Store everything</option><option value="starred_only">Store starred conversations only</option><option value="manual_only">Store manually selected conversations only</option><option value="manual_backups_only">Manual backups only</option>
            </select>
            <p className="mt-2 text-caption">Manual backups use the existing pipeline and can include everything when this policy is manual-only.</p>
          </SurfaceCard>

          <SurfaceCard title="Queue health" description="Upload activity is persisted locally and survives browser restarts." actions={<StatusPill status={state.status} label={state.label} />}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-caption">Pending</p><p className="font-semibold">{queue.pending}</p></div><div><p className="text-caption">Uploading</p><p className="font-semibold">{queue.uploading}</p></div><div><p className="text-caption">Completed</p><p className="font-semibold">{queue.done}</p></div><div><p className="text-caption">Failed</p><p className="font-semibold">{queue.failed}</p></div></div>
            {queue.failed > 0 && <Button className="mt-4" variant="outline" onClick={snapshot.retryFailed}><RefreshCw className="size-4" />Retry failed uploads</Button>}
          </SurfaceCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SurfaceCard title="Encryption and recovery" description="Understand what is required before you create a backup or restore one.">
            <div className="flex gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-status-protected" /><div className="space-y-2 text-sm"><p>Backups are encrypted locally before upload. Your passphrase is required to restore the data.</p><p className="font-medium text-status-attention">If you lose the passphrase, the encrypted backup cannot be recovered.</p><p className="text-muted-foreground">For safety, the passphrase is kept only in this page session and is never saved to localStorage.</p></div></div>
            <label htmlFor="backup-passphrase" className="mt-5 block text-label">Backup passphrase</label>
            <div className="relative mt-2"><Input id="backup-passphrase" type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-describedby="passphrase-help" aria-invalid={passphrase.length > 0 && passphrase.length < 8} autoComplete="off" placeholder="Enter your recovery passphrase" className="pr-11" /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1" onClick={() => setShowPassphrase((visible) => !visible)} aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}>{showPassphrase ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
            <p id="passphrase-help" className="mt-2 text-caption">Use the same passphrase for restore. It is never displayed after you hide it.</p>{passphrase.length > 0 && passphrase.length < 8 && <p className="mt-1 text-sm text-status-error" role="alert">Use at least 8 characters for a stronger recovery passphrase.</p>}
          </SurfaceCard>
           <SurfaceCard title="Latest restore" description="Restoring replaces the current local conversation data with the latest available encrypted snapshot.">
            {latestAvailable ? <div className="space-y-3 text-sm"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-status-success" /><span>Version {latestAvailable.version} is available and stored on Arweave</span></div><p className="text-muted-foreground">Created {formatDate(latestAvailable.createdAt)} · Uploaded {formatDate(latestAvailable.uploadedAt ?? latestAvailable.createdAt)} · {latestAvailable.conversationIds.length} conversations · {latestAvailable.messageCount} messages</p><div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-caption">Arweave transaction</p><p className="mt-1 break-all font-mono text-xs">{latestAvailable.txId}</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={copyTxId}>{copiedTxId ? "Copied" : "Copy transaction ID"}</Button><Button type="button" variant="outline" size="sm" onClick={downloadRecoveryCard}>Download recovery card</Button><a className="inline-flex items-center rounded-md border px-3 py-2 text-xs hover:bg-muted" href={`https://viewblock.io/arweave/tx/${latestAvailable.txId}`} target="_blank" rel="noreferrer">Open in ViewBlock</a><a className="inline-flex items-center rounded-md border px-3 py-2 text-xs hover:bg-muted" href={`https://arweave.net/${latestAvailable.txId}`} target="_blank" rel="noreferrer">Open gateway</a></div></div><p className="text-status-attention">Restore is destructive to current local data and cannot be undone by this UI.</p></div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Archive className="size-5" />Create and upload a backup before restoring.</div>}
            {restoreResult && <p className={restoreResult.status === "restored" ? "mt-4 text-sm text-status-success" : "mt-4 text-sm text-status-error"} role="status">{restoreResult.message}{restoreResult.error ? `: ${restoreResult.error}` : ""}</p>}
             <div className="mt-5 border-t pt-4"><p className="text-label">Recover from another browser</p><p className="mt-1 text-caption">Paste the 43-character transaction ID from your recovery card. This requires the same passphrase.</p><div className="mt-2 flex gap-2"><Input value={manualTxId} onChange={(e) => setManualTxId(e.target.value)} placeholder="Arweave transaction ID" aria-label="Arweave transaction ID" /><Button variant="outline" disabled={restoreWorking || !passphrase || !/^[A-Za-z0-9_-]{43}$/.test(manualTxId.trim())} onClick={() => void restoreManual()}>Restore by ID</Button></div></div>
           </SurfaceCard>
        </div>
      </div>
    </main>
    <ConfirmDialog open={confirm === "backup"} onOpenChange={(open) => !open && setConfirm(null)} title="Create a permanent backup?" consequence="Only the conversations selected by your storage policy will be encrypted locally and queued for Arweave. This is optional. After upload, encrypted data is permanent and cannot be deleted." confirmLabel="Create backup" onConfirm={manualBackup} />
    <ConfirmDialog open={confirm === "restore"} onOpenChange={(open) => !open && setConfirm(null)} title="Restore the latest backup?" consequence="Restore will replace your current local conversations with the selected encrypted snapshot. This action cannot be undone by this UI." confirmLabel="Restore backup" severity="destructive" submitting={restoreWorking} onConfirm={restore} />
  </AppShell>;
}