"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, CheckCircle2, Cloud, Eye, EyeOff, HardDrive, LockKeyhole, RefreshCw, RotateCcw, UploadCloud, Wallet } from "lucide-react";
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
import { restoreLatestSnapshot, restoreSnapshotByTxId, previewSnapshotByTxId, applyRestorePreview, type RestorePreview, type RestoreResult } from "@/lib/arweave/restore";
import type { QueueStatusSummary } from "@/lib/arweave/snapshot-types";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import { downloadJson } from "@/lib/storage/download";
import Arweave from "arweave";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { previewCloudSync, applyCloudSyncChoice, type SyncPreview } from "@/lib/storage/sync-restore";
import { loadStoragePreferences, saveStoragePreferences, type StoragePreferences } from "@/lib/storage/storage-preferences";
import { setSyncPassphrase } from "@/lib/storage/sync-encryption";
import { buildRecoveryBundle, parseRecoveryBundle } from "@/lib/arweave/recovery-bundle";
import { mergeConversationsByMessage } from "@/lib/storage/message-merge";

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

function formatDate(value: string | null, ar: boolean) {
  return value ? new Date(value).toLocaleString(ar ? "ar" : undefined) : (ar ? "أبداً" : "Never");
}

function queueState(queue: QueueStatusSummary, processing: boolean, ar: boolean): { label: string; status: Status } {
  if (queue.failed > 0) return { label: ar ? "فشل" : "Failed", status: "error" };
  if (processing || queue.uploading > 0) return { label: ar ? "جارٍ الرفع" : "Uploading", status: "active" };
  if (queue.pending > 0) return { label: ar ? "قيد الانتظار" : "Pending", status: "attention" };
  if (queue.done > 0) return { label: ar ? "تم" : "Success", status: "success" };
  return { label: ar ? "خامل" : "Idle", status: "neutral" };
}

export default function BackupPage() {
  const ar = useLocale().locale === "ar";
  const conversations = useConversations();
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [policy, setPolicy] = useState<StoragePolicy>("manual_backups_only");
  const [arweaveEnabled, setArweaveEnabled] = useState(false);
  const [cloudPreferences, setCloudPreferences] = useState<StoragePreferences>({ syncMode: "local", syncConversations: false, syncMemories: false, syncProjects: false });
  const [syncPassphrase, setSyncPassphraseValue] = useState("");
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
  const [arweavePreview, setArweavePreview] = useState<RestorePreview | null>(null);
  const [arweavePreviewError, setArweavePreviewError] = useState<string | null>(null);
  const [browserReady, setBrowserReady] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [purchaseMb, setPurchaseMb] = useState("100");
  const [quote, setQuote] = useState<{ ar: number; source: string } | null>(null);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);
  const [purchaseWorking, setPurchaseWorking] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncWorking, setSyncWorking] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [paymentNetwork, setPaymentNetwork] = useState<"ethereum" | "base" | "solana">("ethereum");
  const [paymentToken, setPaymentToken] = useState<"USDC" | "USDT">("USDC");
  const [paymentTxHash, setPaymentTxHash] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const snapshot = useSnapshot(conversations.conversations, conversations.activeId, passphrase || null);
  const previewSync = async () => {
    if (syncWorking) return;
    if (passphrase.length < 8) {
      setSyncMessage(ar ? "اكتب عبارة مرور من 8 أحرف على الأقل قبل معاينة النسخة السحابية." : "Enter a passphrase of at least 8 characters before previewing the cloud copy.");
      return;
    }
    setSyncWorking(true); setSyncMessage(null);
    try { setSyncPreview(await previewCloudSync()); setSyncMessage(ar ? "تم تحميل المعاينة فقط. لم تتغير البيانات المحلية." : "Preview loaded only. Local data was not changed."); }
    catch (error) { setSyncMessage(error instanceof Error ? error.message : (ar ? "فشلت الاستعادة السحابية بأمان." : "Cloud restore failed safely.")); }
    finally { setSyncWorking(false); }
  };
  const applySync = (choice: "cloud" | "merge" | "local") => {
    if (!syncPreview) {
      setSyncMessage(ar ? "حمّل معاينة النسخة السحابية أولاً قبل اختيار هذا الخيار." : "Preview the cloud copy before choosing this option.");
      return;
    }
    if (choice !== "local" && !window.confirm(ar ? "هل توافق صراحةً على تطبيق هذا الخيار؟" : "Do you explicitly approve applying this option?")) return;
    applyCloudSyncChoice(syncPreview, choice);
    if (choice !== "local") conversations.reload();
    setSyncMessage(choice === "local" ? (ar ? "تم الاحتفاظ بالبيانات المحلية." : "Local data was kept.") : (ar ? "تم تطبيق الاستعادة." : "Restore applied."));
  };

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
    setCloudPreferences(loadStoragePreferences());
    refresh();
    setBrowserReady(true);
    void syncPurchasedQuota();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh, syncPurchasedQuota]);
  useEffect(() => { refresh(); }, [snapshot.isProcessing, snapshot.lastSnapshotVersion, refresh]);

  const state = queueState(queue, snapshot.isProcessing, ar);
  const latestAvailable = browserReady ? getAllSnapshots().filter((item) => item.txId).at(-1) ?? null : null;
  const lastUploadedAt = latestAvailable?.uploadedAt ?? latestAvailable?.createdAt ?? null;
  const copyTxId = async () => {
    if (!latestAvailable?.txId) return;
    await navigator.clipboard.writeText(latestAvailable.txId);
    setCopiedTxId(true);
    window.setTimeout(() => setCopiedTxId(false), 1500);
  };
  const downloadRecoveryCard = () => {
    if (!latestAvailable?.txId || passphrase.length < 8) return;
    const bundle = buildRecoveryBundle({ txId: latestAvailable.txId, snapshotVersion: latestAvailable.version, createdAt: latestAvailable.createdAt, passphrase });
    downloadJson(bundle, `permamind-recovery-v${latestAvailable.version}.json`);
  };
  const importRecoveryBundle = async (file: File) => {
    try {
      const bundle = parseRecoveryBundle(JSON.parse(await file.text()));
      setManualTxId(bundle.txId);
      setPassphrase(bundle.passphrase);
      setArweavePreview(null);
      setArweavePreviewError(null);
      setRestoreResult({ status: "cancelled", conversationCount: 0, snapshotVersion: bundle.snapshotVersion, message: ar ? "تم استيراد ملف الاستعادة. راجع المعاينة قبل الكتابة." : "Recovery file imported. Preview it before writing local data.", error: null });
    } catch (error) {
      setArweavePreviewError(error instanceof Error ? error.message : (ar ? "ملف الاستعادة غير صالح" : "Recovery file is invalid"));
    }
  };
  const savePolicy = (value: StoragePolicy) => { setPolicy(value); saveStoragePolicy(value); };
  const updateCloud = (change: Partial<StoragePreferences>) => {
    setCloudPreferences((current) => {
      const next = { ...current, ...change };
      saveStoragePreferences(next);
      return next;
    });
  };
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
  const previewManual = async () => {
    setRestoreWorking(true); setRestoreResult(null); setArweavePreviewError(null);
    try {
      setArweavePreview(await previewSnapshotByTxId({ txId: manualTxId.trim(), passphrase }));
    } catch (error) {
      setArweavePreview(null);
      setArweavePreviewError(error instanceof Error ? error.message : (ar ? "فشلت معاينة الاستعادة" : "Restore preview failed"));
    } finally { setRestoreWorking(false); }
  };
  const applyManualPreview = (mode: "replace" | "merge") => {
    if (!arweavePreview || !window.confirm(ar ? "هل توافق صراحةً على تطبيق هذه المعاينة؟" : "Do you explicitly approve applying this preview?")) return;
    if (mode === "merge") {
      const local = conversations.conversations;
      const plan = mergeConversationsByMessage(local, arweavePreview.conversations);
      setArweavePreview({ ...arweavePreview, addedMessages: plan.addedMessages, conflictedMessages: plan.conflictedMessages, conflictedDecisions: plan.conflictedDecisions });
    }
    applyRestorePreview(arweavePreview, mode);
    conversations.reload();
    setRestoreResult({ status: "restored", conversationCount: arweavePreview.conversations.length, snapshotVersion: arweavePreview.snapshotVersion, message: mode === "merge" ? (ar ? "تم دمج الرسائل. الرسائل والقرارات المتعارضة بقيت كنسختين." : "Messages merged. Conflicting messages and decisions were kept as two copies.") : (ar ? "تم استبدال البيانات المحلية." : "Snapshot restored"), error: null });
  };
  const percentage = usage?.percentageUsed ?? 0;
  const quotaStatus: Status = percentage >= 100 ? "error" : percentage >= 80 ? "attention" : "success";
  const connectWallet = async () => {
    try {
      if (!window.arweaveWallet) throw new Error(ar ? "ثبّت ArConnect لربط محفظة Arweave." : "Install ArConnect to connect an Arweave wallet.");
      await window.arweaveWallet.connect(["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "SIGN_TRANSACTION"]);
      const address = await window.arweaveWallet.getActiveAddress();
      if (!address) throw new Error(ar ? "لم تُرجع المحفظة عنواناً نشطاً." : "The wallet did not return an active address.");
      setWalletAddress(address);
      setPurchaseMessage(null);
      return address;
    } catch (error) {
      setPurchaseMessage(error instanceof Error ? (ar ? `فشل ربط المحفظة: ${error.message}` : `Wallet connection failed: ${error.message}`) : (ar ? "فشل ربط المحفظة." : "Wallet connection failed."));
      return null;
    }
  };
  const disconnectWallet = async () => {
    try {
      const wallet = window.arweaveWallet as ArweaveWalletApi | undefined;
      if (wallet?.disconnect) await wallet.disconnect();
      setWalletAddress(null);
      setPurchaseMessage(ar ? "تم فصل المحفظة عن PermaMind." : "Wallet disconnected from PermaMind.");
    } catch (error) {
      setPurchaseMessage(error instanceof Error ? (ar ? `تعذر فصل المحفظة: ${error.message}` : `Could not disconnect wallet: ${error.message}`) : (ar ? "تعذر فصل المحفظة." : "Could not disconnect wallet."));
    }
  };
  const connectEthereum = async () => {
    const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
    if (!ethereum) return setPurchaseMessage(ar ? "لم يُعثر على MetaMask في هذا المتصفح." : "MetaMask was not found in this browser.");
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts[0]) throw new Error(ar ? "لم تُرجع MetaMask أي حساب." : "MetaMask returned no account.");
      setEthAddress(accounts[0]);
      setPurchaseMessage(ar ? "تم ربط محفظة Ethereum. ما زال دفع AR مطلوباً لخطة التخزين هذه." : "Ethereum wallet connected. AR payment is still required for this storage plan.");
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : (ar ? "فشل ربط محفظة Ethereum." : "Ethereum wallet connection failed.")); }
  };
  const connectSolana = async () => {
    const solana = (window as Window & { solana?: { connect: () => Promise<{ publicKey?: { toString: () => string } }> } }).solana;
    if (!solana) return setPurchaseMessage(ar ? "لم يُعثر على محفظة Solana مثل Phantom في هذا المتصفح." : "A Solana wallet such as Phantom was not found in this browser.");
    try {
      const result = await solana.connect();
      const address = result.publicKey?.toString();
      if (!address) throw new Error(ar ? "لم تُرجع محفظة Solana مفتاحاً عاماً." : "Solana wallet returned no public key.");
      setSolanaAddress(address);
      setPurchaseMessage(ar ? "تم ربط محفظة Solana. ما زال دفع AR مطلوباً لخطة التخزين هذه." : "Solana wallet connected. AR payment is still required for this storage plan.");
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : (ar ? "فشل ربط محفظة Solana." : "Solana wallet connection failed.")); }
  };
  const loadQuote = async () => {
    const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
    if (!Number.isFinite(bytes) || bytes < 1) return setPurchaseMessage(ar ? "أدخل كمية تخزين صحيحة." : "Enter a valid storage amount.");
    const response = await fetch(`/api/storage/quote?bytes=${bytes}`);
    const data = await response.json() as { ar?: number; source?: string; error?: string };
    if (!response.ok) return setPurchaseMessage(data.error ?? (ar ? "تعذر حساب السعر" : "Could not calculate price"));
    setQuote({ ar: data.ar ?? 0, source: data.source ?? "fallback" });
  };
  const purchaseStorage = async () => {
    if (purchaseWorking) return;
    if (!quote) {
      setPurchaseMessage(ar ? "احسب السعر أولاً قبل الدفع وطلب التخزين." : "Get a price before paying and requesting storage.");
      return;
    }
    setPurchaseWorking(true); setPurchaseMessage(null);
    try {
      const address = walletAddress ?? await connectWallet();
      if (!address || !window.arweaveWallet) throw new Error(ar ? "اربط ArConnect أولاً." : "Connect ArConnect first.");
      const paymentAddress = process.env.NEXT_PUBLIC_STORAGE_PAYMENT_ADDRESS;
      if (!paymentAddress) throw new Error(ar ? "مدفوعات التخزين غير مهيأة من المسؤول." : "Storage payments are not configured by the administrator.");
      if (!/^[A-Za-z0-9_-]{43}$/.test(paymentAddress)) {
        throw new Error(ar ? "عنوان الدفع لدى المسؤول ليس عنوان Arweave صالحاً من 43 حرفاً." : "The administrator payment address is not a valid 43-character Arweave address.");
      }
      const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
      const pricing = quote ?? (await (await fetch(`/api/storage/quote?bytes=${bytes}`)).json() as { ar: number });
      const quantity = Math.ceil(pricing.ar * 1e12);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(ar ? "مبلغ الدفع غير صالح." : "Invalid payment amount.");
      // Build a real Arweave transaction first. ArConnect signs this object
      // without exposing the user's private key; dispatch is intentionally not
      // used because its payload contract differs between extension versions.
      const wallet = window.arweaveWallet as ArweaveWalletApi;
      const arweave = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
      const transaction = await arweave.createTransaction({ target: paymentAddress, quantity: String(quantity), data: "" });
      transaction.addTag("App-Name", "PermaMind");
      transaction.addTag("Action", "Storage-Purchase");
      const sign = wallet.signTransaction ?? wallet.sign;
      if (!sign) throw new Error(ar ? "هذه المحفظة لا توفر طريقة توقيع Arweave. حدّث ArConnect." : "This wallet does not expose an Arweave signing method. Update ArConnect.");
      const signed = await sign.call(wallet, transaction) as SignedTransaction | undefined;
      const finalTransaction = (signed ?? transaction) as typeof transaction & SignedTransaction;
      if (!finalTransaction.id || !finalTransaction.signature) throw new Error(ar ? "أعادت المحفظة معاملة غير موقعة." : "Wallet returned an unsigned transaction.");
      const responseFromNetwork = await arweave.transactions.post(finalTransaction);
      if (responseFromNetwork.status < 200 || responseFromNetwork.status >= 300) {
        throw new Error(ar ? `رفضت Arweave الدفع (HTTP ${responseFromNetwork.status}).` : `Arweave rejected the payment (HTTP ${responseFromNetwork.status}).`);
      }
      const txId = finalTransaction.id;
      if (!txId) throw new Error(ar ? "لم تُرجع المحفظة معرّف المعاملة." : "Wallet did not return a transaction ID.");
      const response = await fetch("/api/storage/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes, walletAddress: address, txId }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? (ar ? "فشل تسجيل الشراء" : "Purchase registration failed"));
      setPurchaseMessage(ar ? "تم إرسال الدفع. سيُفعَّل التخزين بعد تأكيد الشبكة." : "Payment submitted. Storage will be activated after network confirmation.");
      window.setTimeout(() => void syncPurchasedQuota(), 15_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPurchaseMessage(message ? (ar ? `فشل الشراء: ${message}` : `Purchase failed: ${message}`) : (ar ? "فشل الشراء. تحقق من إضافة المحفظة." : "Purchase failed. Check the wallet extension."));
    }
    finally { setPurchaseWorking(false); }
  };
  const registerTokenPayment = async () => {
    if (purchaseWorking) return;
    const walletReady = paymentNetwork === "solana" ? Boolean(solanaAddress) : Boolean(ethAddress);
    if (!paymentTxHash.trim() || !tokenAmount.trim() || !walletReady) {
      setPurchaseMessage(ar ? "اربط المحفظة المناسبة وأدخل مبلغ العملة ومعرّف المعاملة قبل التحقق." : "Connect the matching wallet and enter the token amount and transaction ID before verifying.");
      return;
    }
    setPurchaseWorking(true); setPurchaseMessage(null);
    try {
      const bytes = Math.floor(Number(purchaseMb) * 1024 * 1024);
      const response = await fetch("/api/storage/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes, walletAddress: paymentNetwork === "solana" ? solanaAddress : ethAddress, txId: paymentTxHash, network: paymentNetwork, token: paymentToken, tokenAmount }) });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? (ar ? "فشل التحقق من الدفع" : "Payment verification failed"));
      setPurchaseMessage(data.message ?? (ar ? "تم التحقق من الدفع. معالجة Arweave قيد الانتظار." : "Payment verified. Arweave processing is pending."));
      void syncPurchasedQuota();
    } catch (error) { setPurchaseMessage(error instanceof Error ? error.message : (ar ? "فشل تسجيل الدفع" : "Payment registration failed")); }
    finally { setPurchaseWorking(false); }
  };

  return <AppShell activeArea="backup" onNavigate={(area) => { window.location.href = `/${area}`; }}>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader eyebrow={ar ? "نسخ احتياطي اختياري" : "Optional encrypted backup"} title={ar ? "مركز النسخ الاحتياطي" : "Backup Center"} description={ar ? "تبقى محادثاتك محلياً افتراضياً. اختر يدوياً ما تريد تشفيره ورفعه إلى Arweave." : "Your conversations stay local by default. Manually choose what to encrypt and upload to Arweave."} />
        <SurfaceCard title={ar ? "كيف تحمي بياناتك؟" : "How your recovery works"} description={ar ? "شرح بسيط قبل البدء" : "A simple explanation before you start"}>
          <div className="space-y-2 text-sm"><p>{ar ? "تبقى محادثاتك محلياً ولا يتم رفعها تلقائياً. عند اختيار نسخة احتياطية، نشفّرها داخل متصفحك قبل رفعها. Arweave يحفظ النسخة المشفرة ولا يستطيع قراءة محتواها." : "Your conversations remain local and are not uploaded automatically. When you choose a backup, it is encrypted in this browser before upload. Arweave stores the encrypted copy and cannot read it."}</p><p>{ar ? "الحذف المحلي لا يحذف النسخة المرفوعة: إذا حذفت محادثة من هذا الجهاز فقد تبقى نسختها المشفرة بشكل دائم على Arweave." : "Delete locally does not delete an uploaded backup: if you delete a conversation from this device, its encrypted copy may remain permanently on Arweave."}</p><p className="font-medium text-status-attention">{ar ? "لا تحفظ عبارة المرور في المتصفح أو في بطاقة الاستعادة. فقدانها يعني فقدان القدرة على فك النسخة." : "Do not rely on the browser or recovery card to store your passphrase. Losing it means the encrypted backup cannot be decrypted."}</p></div>
        </SurfaceCard>

        <section className="space-y-3" aria-labelledby="storage-methods-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="storage-methods-title" className="text-section-title">{ar ? "اختر طريقة التخزين" : "Choose a storage method"}</h2>
              <p className="text-caption">{ar ? "كل طريقة مستقلة. تشغيل واحدة لا يغيّر الأخريين ولا يرفع شيئاً وحده." : "Each method is independent. Turning one on does not change the others or upload anything by itself."}</p>
            </div>
            <Link href="/storage" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{ar ? "ما الفرق؟" : "What is the difference?"}</Link>
          </div>
          <div id="storage-method-cards" className="grid items-start gap-4 lg:grid-cols-3">
            <SurfaceCard title={ar ? "محلي" : "Local"} description={ar ? "يعمل دائماً على هذا الجهاز." : "Always on, on this device."} actions={<HardDrive className="size-4 text-status-protected" />}>
              <p className="text-sm">{ar ? "تبقى المحادثات هنا ولا تُرفع. هذه الطريقة لا يمكن إطفاؤها." : "Conversations stay here and are not uploaded. This method cannot be turned off."}</p>
              <p className="mt-3 text-caption">{ar ? "المحتوى: محادثات هذا الجهاز." : "Contents: conversations on this device."}</p>
              <Link href="/storage" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">{ar ? "شرح هذه الطريقة" : "How this works"}</Link>
            </SurfaceCard>
            <SurfaceCard title={ar ? "سحابي" : "Cloud"} description="Supabase" actions={<Cloud className="size-4 text-muted-foreground" />}>
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                {ar ? "استخدام التخزين السحابي" : "Use cloud storage"}
                <input type="checkbox" checked={cloudPreferences.syncMode === "supabase"} onChange={(event) => updateCloud({ syncMode: event.target.checked ? "supabase" : "local" })} aria-label={ar ? "استخدام التخزين السحابي" : "Use cloud storage"} />
              </label>
              {cloudPreferences.syncMode === "supabase" && <div className="mt-3 space-y-2 text-sm">
                <p className="text-caption">{ar ? "اختر ما يمكن استخدامه. لا يتم الرفع إلا بعد تحذير وتأكيد لكل محادثة." : "Choose what may be used. Nothing uploads until a warning and confirmation for each conversation."}</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={cloudPreferences.syncConversations} onChange={(event) => updateCloud({ syncConversations: event.target.checked })} />{ar ? "المحادثات" : "Conversations"}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={cloudPreferences.syncMemories} onChange={(event) => updateCloud({ syncMemories: event.target.checked })} />{ar ? "الذكريات" : "Memories"}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={cloudPreferences.syncProjects} onChange={(event) => updateCloud({ syncProjects: event.target.checked })} />{ar ? "المشاريع" : "Projects"}</label>
                <Input type="password" value={syncPassphrase} onChange={(event) => { setSyncPassphraseValue(event.target.value); setSyncPassphrase(event.target.value); }} placeholder={ar ? "عبارة مرور المزامنة (في الذاكرة فقط)" : "Sync passphrase (kept in memory only)"} autoComplete="off" />
              </div>}
              <Link href="/storage" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">{ar ? "شرح هذه الطريقة" : "How this works"}</Link>
            </SurfaceCard>
            <SurfaceCard title="Arweave" description={ar ? "نسخة دائمة ومشفّرة، ومنفصلة عن السحابة." : "A permanent encrypted backup, separate from cloud."} actions={<LockKeyhole className="size-4 text-status-attention" />}>
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                {ar ? "استخدام Arweave" : "Use Arweave"}
                <input type="checkbox" checked={arweaveEnabled} onChange={(event) => setArweaveEnabled(event.target.checked)} aria-label={ar ? "استخدام Arweave" : "Use Arweave"} />
              </label>
              {arweaveEnabled && <div className="mt-3 space-y-2">
                <label htmlFor="storage-arweave-policy" className="text-label">{ar ? "ما الذي يدخل النسخة؟" : "What may be included?"}</label>
                <select id="storage-arweave-policy" className="w-full rounded-md border bg-background p-2.5 text-sm" value={policy} onChange={(event) => savePolicy(event.target.value as StoragePolicy)}>
                  <option value="store_everything">{ar ? "كل المحادثات" : "All conversations"}</option>
                  <option value="starred_only">{ar ? "المحادثات المميزة فقط" : "Starred conversations only"}</option>
                  <option value="manual_only">{ar ? "المحادثات المختارة يدوياً فقط" : "Manually selected conversations only"}</option>
                  <option value="manual_backups_only">{ar ? "عند الضغط على نسخ احتياطي الآن فقط" : "Only when I press Back up now"}</option>
                </select>
                <p className="text-caption text-status-attention">{ar ? "بعد الرفع لا يمكن حذف النسخة. الإنشاء ما زال يحتاج تأكيداً." : "After upload, the copy cannot be deleted. Creating one still needs confirmation."}</p>
              </div>}
              <Link href="/storage" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">{ar ? "شرح هذه الطريقة" : "How this works"}</Link>
            </SurfaceCard>
          </div>
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SurfaceCard title={ar ? "التشفير والاستعادة" : "Encryption and recovery"} description={ar ? "افهم ما هو مطلوب قبل إنشاء نسخة أو استعادتها." : "Understand what is required before you create a backup or restore one."}>
            <div className="flex gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-status-protected" /><div className="space-y-2 text-sm"><p>{ar ? "تُشفَّر النسخ محلياً قبل الرفع. عبارة المرور مطلوبة لاستعادة البيانات." : "Backups are encrypted locally before upload. Your passphrase is required to restore the data."}</p><p className="font-medium text-status-attention">{ar ? "إذا فقدت عبارة المرور، لا يمكن استعادة النسخة المشفرة." : "If you lose the passphrase, the encrypted backup cannot be recovered."}</p><p className="text-muted-foreground">{ar ? "للأمان، تبقى عبارة المرور في جلسة هذه الصفحة فقط ولا تُحفظ في localStorage." : "For safety, the passphrase is kept only in this page session and is never saved to localStorage."}</p></div></div>
            <label htmlFor="backup-passphrase" className="mt-5 block text-label">{ar ? "عبارة مرور النسخة" : "Backup passphrase"}</label>
            <div className="relative mt-2"><Input id="backup-passphrase" type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-describedby="passphrase-help" aria-invalid={passphrase.length > 0 && passphrase.length < 8} autoComplete="off" placeholder={ar ? "أدخل عبارة الاستعادة" : "Enter your recovery passphrase"} className="pe-11" /><button type="button" className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1" onClick={() => setShowPassphrase((visible) => !visible)} aria-label={showPassphrase ? (ar ? "إخفاء عبارة المرور" : "Hide passphrase") : (ar ? "إظهار عبارة المرور" : "Show passphrase")}>{showPassphrase ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
            <p id="passphrase-help" className="mt-2 text-caption">{ar ? "استخدم العبارة نفسها عند الاستعادة. لا تُعرض بعد إخفائها." : "Use the same passphrase for restore. It is never displayed after you hide it."}</p>{passphrase.length > 0 && passphrase.length < 8 && <p className="mt-1 text-sm text-status-error" role="alert">{ar ? "استخدم 8 أحرف على الأقل لعبارة استعادة أقوى." : "Use at least 8 characters for a stronger recovery passphrase."}</p>}
          </SurfaceCard>

          <SurfaceCard title={ar ? "نظرة عامة على النسخ الاحتياطي" : "Backup overview"} description={ar ? "تبقى المحادثات المحلية متاحة حتى عند انتظار النسخ أو عدم توفره." : "Local conversations remain available even when a backup is queued or unavailable."} actions={<StatusPill status={state.status} label={state.label} />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-caption">{ar ? "النسخة الحالية" : "Current snapshot"}</p><p className="mt-1 text-lg font-semibold">{lastSnapshot ? (ar ? `الإصدار ${lastSnapshot.version}` : `Version ${lastSnapshot.version}`) : (ar ? "لم تُنشأ بعد" : "Not created yet")}</p></div>
              <div><p className="text-caption">{ar ? "آخر رفع ناجح" : "Last successful upload"}</p><p className="mt-1 font-medium">{formatDate(lastUploadedAt, ar)}</p></div>
              <div><p className="text-caption">{ar ? "محادثات جاهزة" : "Conversations ready"}</p><p className="mt-1 font-medium">{conversations.conversations.length}</p></div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button onClick={() => setConfirm("backup")} disabled={!passphrase || snapshot.isProcessing} aria-label={ar ? "إنشاء نسخة احتياطية مشفرة يدوياً" : "Create a manual encrypted backup"}><UploadCloud className="size-4" />{snapshot.isProcessing ? (ar ? "جارٍ إنشاء النسخة…" : "Creating backup…") : (ar ? "نسخ احتياطي الآن" : "Back up now")}</Button>
              <Button variant="outline" onClick={() => setConfirm("restore")} disabled={!passphrase || !latestAvailable || restoreWorking} aria-label={ar ? "استعادة أحدث نسخة احتياطية" : "Restore the latest backup"}><RotateCcw className="size-4" />{ar ? "استعادة الأحدث" : "Restore latest"}</Button>
            </div>
            <div className="sr-only" aria-live="polite">{snapshot.isProcessing ? (ar ? "النسخ الاحتياطي قيد التنفيذ" : "Backup is in progress") : restoreWorking ? (ar ? "الاستعادة قيد التنفيذ" : "Restore is in progress") : restoreResult?.message ?? ""}</div>
          </SurfaceCard>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SurfaceCard title={ar ? "سياسة النسخ الاحتياطي" : "Backup policy"} description={arweaveEnabled ? (ar ? "هذه هي المحادثات التي حددتها لطريقة Arweave." : "These are the conversations you selected for Arweave.") : (ar ? "شغّل Arweave أعلاه لاختيار ما يدخل النسخة الدائمة." : "Turn on Arweave above to choose what a permanent backup may include.")}>
            <label htmlFor="backup-policy" className="text-label">{ar ? "سياسة التخزين الدائم" : "Permanent storage policy"}</label>
            <select id="backup-policy" className="mt-2 w-full rounded-md border bg-background p-2.5 text-sm disabled:opacity-60" value={policy} disabled={!arweaveEnabled} onChange={(event) => savePolicy(event.target.value as StoragePolicy)}>
              <option value="store_everything">{ar ? "تخزين كل شيء" : "Store everything"}</option><option value="starred_only">{ar ? "تخزين المحادثات المميزة فقط" : "Store starred conversations only"}</option><option value="manual_only">{ar ? "تخزين المحادثات المختارة يدوياً فقط" : "Store manually selected conversations only"}</option><option value="manual_backups_only">{ar ? "نسخ يدوية فقط" : "Manual backups only"}</option>
            </select>
            <p className="mt-2 text-caption">{ar ? "النسخ اليدوي يستخدم المسار نفسه ويمكن أن يشمل كل شيء عندما تكون هذه السياسة يدوية فقط." : "Manual backups use the existing pipeline and can include everything when this policy is manual-only."}</p>
          </SurfaceCard>
          <SurfaceCard title={ar ? "استخدام التخزين" : "Storage usage"} description={ar ? "الحصة المجانية: 15 ميجابايت. الحد الأقصى للرفع الفردي 50 ميجابايت." : "Free quota: 15 MB. Each individual upload can be up to 50 MB; paid quota applies after the free allowance."}>
            {usage && <StorageMeter label={ar ? "المساحة المستخدمة" : "Storage used"} used={`${usage.usedMb.toFixed(2)} MB`} total={ar ? `حصة ${(usage.freeQuotaBytes / 1024 / 1024).toFixed(0)} MB` : `${(usage.freeQuotaBytes / 1024 / 1024).toFixed(0)} MB quota`} percentage={quotaStatus === "success" && usage.purchasedQuotaBytes > 0 ? Math.min(100, usage.usedBytes / usage.freeQuotaBytes * 100) : usage.percentageUsed} status={quotaStatus} />}
            {usage && usage.purchasedQuotaBytes > 0 && <p className="mt-2 text-xs text-muted-foreground">{ar ? `مساحة مدفوعة مضافة: ${(usage.purchasedQuotaBytes / 1024 / 1024).toFixed(0)} MB` : `Paid storage added: ${(usage.purchasedQuotaBytes / 1024 / 1024).toFixed(0)} MB`}</p>}
            {usage && usage.percentageUsed >= 80 && <p className="mt-4 text-sm text-status-attention">{usage.percentageUsed >= 100 ? (ar ? "التخزين ممتلئ. قد تُمنع الرفعات الجديدة، ولن تُحذف المحادثات المحلية." : "Storage is full. New uploads may be blocked; local conversations are not deleted.") : (ar ? "التخزين أوشك على الامتلاء. راجع الاستخدام قبل إنشاء مزيد من النسخ." : "Storage is nearly full. Review usage before creating more backups.")}</p>}
          </SurfaceCard>
        </div>

        <SurfaceCard title={ar ? "آخر استعادة" : "Latest restore"} description={ar ? "الاستعادة تستبدل بيانات المحادثات المحلية الحالية بأحدث نسخة مشفرة متاحة." : "Restoring replaces the current local conversation data with the latest available encrypted snapshot."}>
          {latestAvailable ? <div className="space-y-3 text-sm"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-status-success" /><span>{ar ? `الإصدار ${latestAvailable.version} متاح ومحفوظ على Arweave` : `Version ${latestAvailable.version} is available and stored on Arweave`}</span></div><p className="text-muted-foreground">{ar ? `أُنشئت ${formatDate(latestAvailable.createdAt, true)} · رُفعت ${formatDate(latestAvailable.uploadedAt ?? latestAvailable.createdAt, true)} · ${latestAvailable.conversationIds.length} محادثات · ${latestAvailable.messageCount} رسائل` : `Created ${formatDate(latestAvailable.createdAt, false)} · Uploaded ${formatDate(latestAvailable.uploadedAt ?? latestAvailable.createdAt, false)} · ${latestAvailable.conversationIds.length} conversations · ${latestAvailable.messageCount} messages`}</p><div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-caption">{ar ? "معاملة Arweave" : "Arweave transaction"}</p><p className="mt-1 break-all font-mono text-xs">{latestAvailable.txId}</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={copyTxId}>{copiedTxId ? (ar ? "تم النسخ" : "Copied") : (ar ? "نسخ معرّف المعاملة" : "Copy transaction ID")}</Button><Button type="button" variant="outline" size="sm" disabled={passphrase.length < 8} onClick={downloadRecoveryCard}>{ar ? "تنزيل حزمة الاستعادة" : "Download recovery file"}</Button><a className="inline-flex items-center rounded-md border px-3 py-2 text-xs hover:bg-muted" href={`https://viewblock.io/arweave/tx/${latestAvailable.txId}`} target="_blank" rel="noreferrer">{ar ? "فتح في ViewBlock" : "Open in ViewBlock"}</a><a className="inline-flex items-center rounded-md border px-3 py-2 text-xs hover:bg-muted" href={`https://arweave.net/${latestAvailable.txId}`} target="_blank" rel="noreferrer">{ar ? "فتح البوابة" : "Open gateway"}</a></div></div><p className="text-status-attention">{ar ? "الاستعادة تستبدل البيانات المحلية الحالية ولا يمكن التراجع عنها من هذه الواجهة." : "Restore is destructive to current local data and cannot be undone by this UI."}</p></div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Archive className="size-5" />{ar ? "أنشئ نسخة وارفعها قبل الاستعادة." : "Create and upload a backup before restoring."}</div>}
          {restoreResult && <p className={restoreResult.status === "restored" ? "mt-4 text-sm text-status-success" : "mt-4 text-sm text-status-error"} role="status">{restoreResult.message}{restoreResult.error ? `: ${restoreResult.error}` : ""}</p>}
          <div className="mt-5 border-t pt-4"><p className="text-label">{ar ? "الاستعادة من متصفح آخر" : "Recover from another browser"}</p><p className="mt-1 text-caption">{ar ? "استورد ملف الاستعادة أو أدخل معرّف Arweave وكلمة المرور. الملف يحتوي كلمة المرور؛ احتفظ به خارج المتصفح. فقدانه أو فقدان كلمة المرور يجعل النسخة غير قابلة للقراءة." : "Import the recovery file, or enter the Arweave ID and passphrase manually. The file contains the passphrase, so keep it outside the browser. Losing either makes the archive unreadable."}</p><label className="mt-2 inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-xs hover:bg-muted">{ar ? "استيراد حزمة الاستعادة" : "Import recovery file"}<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRecoveryBundle(file); event.target.value = ""; }} /></label><div className="mt-2 flex gap-2"><Input value={manualTxId} onChange={(e) => { setManualTxId(e.target.value); setArweavePreview(null); setArweavePreviewError(null); }} placeholder={ar ? "معرّف معاملة Arweave" : "Arweave transaction ID"} aria-label={ar ? "معرّف معاملة Arweave" : "Arweave transaction ID"} /><Button variant="outline" disabled={restoreWorking || !passphrase || !/^[A-Za-z0-9_-]{43}$/.test(manualTxId.trim())} onClick={() => void previewManual()}>{ar ? "معاينة النسخة المشفرة" : "Preview encrypted snapshot"}</Button></div>{arweavePreviewError && <p className="mt-2 text-sm text-status-error" role="alert">{arweavePreviewError}</p>}{arweavePreview && <div className="mt-3 rounded-md border p-3 text-sm"><p>{ar ? `النسخة v${arweavePreview.snapshotVersion} · ${arweavePreview.conversations.length} محادثات · ${arweavePreview.messageCount} رسائل` : `Snapshot v${arweavePreview.snapshotVersion} · ${arweavePreview.conversations.length} conversations · ${arweavePreview.messageCount} messages`}</p><p className="mt-1 text-caption">{ar ? "اكتمل التنزيل والتحقق وفك التشفير وفك الضغط محلياً. المعاينة لم تغيّر البيانات المحلية." : "Download, verification, decryption and decompression completed locally. Preview did not change local data."}</p><div className="mt-2 flex gap-2"><Button onClick={() => applyManualPreview("replace")}>{ar ? "استعادة النسخة" : "Restore snapshot"}</Button><Button variant="outline" onClick={() => applyManualPreview("merge")}>{ar ? "دمج مع المحلية" : "Merge with local"}</Button></div></div>}</div>
        </SurfaceCard>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SurfaceCard title={ar ? "شراء مساحة دائمة إضافية" : "Buy more permanent storage"} description={ar ? "يُحسب السعر من سعر شبكة Arweave الحالي. الدفع يتطلب محفظة Arweave." : "The price is calculated from the current Arweave network price. Payment requires an Arweave wallet."}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void connectWallet()}><Wallet className="size-4" />{walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : (ar ? "ربط ArConnect" : "Connect ArConnect")}</Button>
              {walletAddress && <Button variant="outline" onClick={() => void disconnectWallet()}>{ar ? "فصل المحفظة" : "Disconnect wallet"}</Button>}
              <Button variant="outline" onClick={() => void connectEthereum()}>{ethAddress ? `MetaMask ${ethAddress.slice(0, 6)}…` : (ar ? "ربط MetaMask" : "Connect MetaMask")}</Button>
              <Button variant="outline" onClick={() => void connectSolana()}>{solanaAddress ? `Solana ${solanaAddress.slice(0, 6)}…` : (ar ? "ربط Solana" : "Connect Solana")}</Button>
              <Button variant="outline" onClick={() => { setPurchaseMb("100"); void loadQuote(); }}>{ar ? "100 ميجابايت" : "100 MB"}</Button>
            </div>
            <label htmlFor="purchase-storage" className="mt-4 block text-label">{ar ? "كمية مخصصة (ميجابايت)" : "Custom amount (MB)"}</label>
            <div className="mt-2 flex gap-2"><Input id="purchase-storage" type="number" min="1" step="1" value={purchaseMb} onChange={(event) => setPurchaseMb(event.target.value)} /><Button variant="outline" onClick={() => void loadQuote()}>{ar ? "احسب السعر" : "Get price"}</Button></div>
            {quote && <p className="mt-3 text-sm">{ar ? "السعر التقريبي:" : "Estimated price:"} <strong>{quote.ar.toFixed(9)} AR</strong> <span className="text-caption">({quote.source === "arweave-network" ? (ar ? "سعر الشبكة المباشر" : "live network price") : (ar ? "تقدير احتياطي" : "fallback estimate")})</span></p>}
            <Button className={cn("mt-3", (purchaseWorking || !quote) && "cursor-not-allowed opacity-60")} onClick={() => void purchaseStorage()}><Wallet className="size-4" />{purchaseWorking ? (ar ? "جارٍ الإرسال…" : "Submitting…") : (ar ? "ادفع واطلب التخزين" : "Pay and request storage")}</Button>
          </SurfaceCard>
          <SurfaceCard title={ar ? "الدفع بعملة مستقرة" : "Pay with a stablecoin"} description={ar ? "أرسل مبلغ العملة المسعّر تماماً إلى العنوان المحدد، ثم أدخل تجزئة المعاملة. رسوم الشبكة تدفعها محفظتك بشكل منفصل." : "Send the exact quoted token amount to the configured address, then submit the transaction hash. Gas is paid separately by your wallet."}>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="rounded-md border bg-background p-2 text-sm" value={paymentNetwork} onChange={(e) => setPaymentNetwork(e.target.value as typeof paymentNetwork)} aria-label={ar ? "شبكة الدفع" : "Payment network"}><option value="ethereum">Ethereum</option><option value="base">Base</option><option value="solana">Solana</option></select>
              <select className="rounded-md border bg-background p-2 text-sm" value={paymentToken} onChange={(e) => setPaymentToken(e.target.value as typeof paymentToken)} aria-label={ar ? "عملة الدفع" : "Payment token"}><option>USDC</option><option>USDT</option></select>
              <Input placeholder={ar ? "مبلغ العملة (أصغر وحدة)" : "Token amount (smallest units)"} value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} inputMode="numeric" aria-label={ar ? "مبلغ العملة" : "Token amount"} />
            </div>
            <Input className="mt-2" placeholder={ar ? "تجزئة المعاملة أو التوقيع" : "Transaction hash/signature"} value={paymentTxHash} onChange={(e) => setPaymentTxHash(e.target.value)} aria-label={ar ? "تجزئة المعاملة" : "Transaction hash"} />
            <Button className={cn("mt-2", (purchaseWorking || !paymentTxHash || !tokenAmount || (paymentNetwork === "solana" ? !solanaAddress : !ethAddress)) && "cursor-not-allowed opacity-60")} variant="outline" onClick={() => void registerTokenPayment()}>{ar ? "تحقق من دفع العملة المستقرة" : "Verify stablecoin payment"}</Button>
            {purchaseMessage && <p className="mt-3 text-sm text-status-attention" role="status">{purchaseMessage}</p>}
            <p className="mt-3 text-caption">{ar ? "التحقق من USDC/USDT يتم على الخادم. بعد التحقق، قد تستغرق معالجة التخزين الدائم على Arweave بعض الوقت." : "USDC/USDT verification is server-side. After verification, Arweave permanent-storage processing may take time."}</p>
          </SurfaceCard>
        </div>

        <SurfaceCard title={ar ? "استعادة Supabase من جهاز آخر" : "Restore Supabase data from another device"} description={ar ? "يتم تنزيل ciphertext وفك تشفيره محلياً. لا يتم تعديل بياناتك دون موافقة صريحة." : "Only ciphertext is downloaded and decrypted locally. Nothing changes without explicit approval."}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={cn((syncWorking || passphrase.length < 8) && "cursor-not-allowed opacity-60")} onClick={() => void previewSync()}><Eye className="size-4" />{syncWorking ? (ar ? "جارٍ التحميل…" : "Loading…") : (ar ? "معاينة النسخة السحابية" : "Preview cloud copy")}</Button>
            <Button variant="outline" className={cn(!syncPreview && "cursor-not-allowed opacity-60")} onClick={() => applySync("cloud")}>{ar ? "استخدام النسخة السحابية" : "Use cloud copy"}</Button>
            <Button variant="outline" className={cn(!syncPreview && "cursor-not-allowed opacity-60")} onClick={() => applySync("merge")}>{ar ? "دمج مع المحلية" : "Merge with local"}</Button>
            <Button variant="outline" className={cn(!syncPreview && "cursor-not-allowed opacity-60")} onClick={() => applySync("local")}>{ar ? "الاحتفاظ بالمحلية" : "Keep local"}</Button>
          </div>
          {syncPreview && <div className="mt-4 rounded-md border p-3 text-sm"><p className="font-medium">{ar ? "المعاينة" : "Preview"}</p><p className="mt-1">{syncPreview.conversations ? (ar ? `${syncPreview.conversations.added} مضافة · ${syncPreview.conversations.replaced} أحدث في السحابة · ${syncPreview.conversations.keptLocal} بقيت محلية` : `${syncPreview.conversations.added} added · ${syncPreview.conversations.replaced} newer in cloud · ${syncPreview.conversations.keptLocal} kept local`) : (ar ? "لم يُعثر على محادثات سحابية." : "No cloud conversations found.")}</p><p className="mt-1 text-caption">{ar ? "تستخدم المقارنة updatedAt وcontentHash. المعاينة لا تكتب إلى localStorage." : "Comparison uses updatedAt and contentHash. Preview does not write to localStorage."}</p></div>}
          {syncMessage && <p className="mt-3 text-sm" role="status">{syncMessage}</p>}
        </SurfaceCard>

        <SurfaceCard className="lg:max-w-3xl" title={ar ? "حالة الرفع " : "Queue health"} description={ar ? "تُحفظ النسخ المشفرة على الخادم مخزنة محليا حتى تقوم برفعها. إغلاق هذا المتصفح لا يلغي نسخة تم رفعها أو قيد الانتظار." : "Encrypted copies are stored on the server until an independent worker uploads them. Closing this browser does not cancel a queued copy."} actions={<StatusPill status={state.status} label={state.label} />}>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-caption">{ar ? "قيد الانتظار" : "Pending"}</p><p className="font-semibold">{queue.pending}</p></div><div><p className="text-caption">{ar ? "جارٍ الرفع" : "Uploading"}</p><p className="font-semibold">{queue.uploading}</p></div><div><p className="text-caption">{ar ? "مكتمل" : "Completed"}</p><p className="font-semibold">{queue.done}</p></div><div><p className="text-caption">{ar ? "فشل" : "Failed"}</p><p className="font-semibold">{queue.failed}</p></div></div>
          {queue.failed > 0 && <Button className="mt-4" variant="outline" onClick={snapshot.retryFailed}><RefreshCw className="size-4" />{ar ? "إعادة محاولة الرفع الفاشل" : "Retry failed uploads"}</Button>}
        </SurfaceCard>
      </div>
    </main>
    <ConfirmDialog open={confirm === "backup"} onOpenChange={(open) => !open && setConfirm(null)} title={ar ? "إنشاء نسخة دائمة؟" : "Create a permanent backup?"} consequence={ar ? "ستُشفَّر محلياً المحادثات التي تحددها سياسة التخزين فقط، ثم تُوضع في طابور Arweave. هذا اختياري. بعد الرفع تصبح البيانات المشفرة دائمة ولا يمكن حذفها." : "Only the conversations selected by your storage policy will be encrypted locally and queued for Arweave. This is optional. After upload, encrypted data is permanent and cannot be deleted."} confirmLabel={ar ? "إنشاء النسخة" : "Create backup"} onConfirm={manualBackup} />
    <ConfirmDialog open={confirm === "restore"} onOpenChange={(open) => !open && setConfirm(null)} title={ar ? "استعادة أحدث نسخة؟" : "Restore the latest backup?"} consequence={ar ? "ستستبدل الاستعادة محادثاتك المحلية الحالية بالنسخة المشفرة المختارة. لا يمكن التراجع عن هذا الإجراء من هذه الواجهة." : "Restore will replace your current local conversations with the selected encrypted snapshot. This action cannot be undone by this UI."} confirmLabel={ar ? "استعادة النسخة" : "Restore backup"} severity="destructive" submitting={restoreWorking} onConfirm={restore} />
  </AppShell>;
}
