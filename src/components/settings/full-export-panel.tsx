"use client";

import { AlertCircle, CheckCircle2, FileJson, Lock, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useLocale } from "@/hooks/use-locale";
import { MIN_PASSPHRASE_LENGTH } from "@/lib/arweave/constants";
import {
  applyImport,
  buildFullExport,
  downloadBlob,
  fullExportFileName,
  plainExportFileName,
  previewImportFile,
  serializeEncryptedExport,
  serializePlainExport,
  type ImportPreview,
} from "@/lib/storage/full-export";

type Phase = "idle" | "working" | "done" | "error";

interface Notice {
  tone: "success" | "error";
  text: string;
}

/**
 * Full account export and import.
 *
 * Two export shapes are offered because they serve different needs. The plain
 * JSON file is readable and lets the user inspect or self-host their own data,
 * which is the honest reading of "your memory is yours". The encrypted archive
 * is for moving an account to another device, where the file may sit in a cloud
 * folder, and reuses the same AES-256-GCM pipeline as the Arweave backup.
 *
 * Import always shows a plan first and merges rather than replaces, so a stale
 * file cannot wipe newer local work.
 */
export function FullExportPanel({ onImported }: { onImported?: () => void }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPreview(null);
    setPassphrase("");
    setNotice(null);
    setPhase("idle");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const exportPlain = useCallback(() => {
    try {
      const data = buildFullExport();
      const blob = new Blob([serializePlainExport(data)], { type: "application/json" });
      downloadBlob(blob, plainExportFileName());
      setNotice({
        tone: "success",
        text: ar
          ? `تم تصدير ${data.summary.conversations} محادثة و ${data.summary.records} ذكرى.`
          : `Exported ${data.summary.conversations} conversations and ${data.summary.records} memories.`,
      });
      setPhase("done");
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setPhase("error");
    }
  }, [ar]);

  const exportEncrypted = useCallback(async () => {
    if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
      setNotice({
        tone: "error",
        text: ar
          ? `استخدم عبارة مرور من ${MIN_PASSPHRASE_LENGTH} أحرف على الأقل.`
          : `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`,
      });
      setPhase("error");
      return;
    }
    setPhase("working");
    setNotice(null);
    try {
      const data = buildFullExport();
      const blob = await serializeEncryptedExport(data, passphrase);
      downloadBlob(blob, fullExportFileName());
      setNotice({
        tone: "success",
        text: ar
          ? "تم إنشاء نسخة مشفّرة. احتفظ بعبارة المرور، فهي لا تُحفظ في أي مكان."
          : "Encrypted archive created. Keep the passphrase; it is not stored anywhere.",
      });
      setPhase("done");
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setPhase("error");
    }
  }, [ar, passphrase]);

  const pickFile = useCallback(async (file: File | undefined, unlock: string) => {
    if (!file) return;
    setPhase("working");
    setNotice(null);
    try {
      const result = await previewImportFile(file, unlock || undefined);
      setPreview(result);
      setPhase("done");
    } catch (error) {
      setPreview(null);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setPhase("error");
    }
  }, []);

  const confirmImport = useCallback(() => {
    if (!preview) return;
    try {
      const result = applyImport(preview.data);
      setNotice({
        tone: "success",
        text: ar
          ? `اكتمل الاستيراد. لديك الآن ${result.conversations} محادثة و ${result.records} ذكرى.`
          : `Import complete. You now have ${result.conversations} conversations and ${result.records} memories.`,
      });
      onImported?.();
      reset();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      setPhase("error");
    }
  }, [ar, onImported, preview, reset]);

  const plan = preview?.plan;

  return (
    <SurfaceCard
      title={ar ? "تصدير واستيراد كل شيء" : "Export and import everything"}
      description={
        ar
          ? "نسخة واحدة تحتوي محادثاتك وذكرياتك ومشاريعك وإعداداتك. تُنشأ على جهازك فقط."
          : "One file containing your conversations, memories, projects, and preferences. Created on this device only."
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-success" />
          <span>
            {ar
              ? "لا يغادر أي شيء هذا الجهاز. مفتاح API لا يُصدَّر أبداً، وتبقى كلمة مرور النسخة المشفّرة في ذاكرتك فقط."
              : "Nothing leaves this device. Your API key is never exported, and the encrypted archive passphrase stays only in your memory."}
          </span>
        </div>

        <section aria-labelledby="full-export-out">
          <h3 id="full-export-out" className="text-label">
            {ar ? "تصدير" : "Export"}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={exportPlain}>
              <FileJson className="size-4" />
              {ar ? "نسخة JSON واضحة" : "Readable JSON"}
            </Button>
          </div>
          <p className="mt-1 text-caption">
            {ar
              ? "ملف يمكنك فتحه وقراءته. مناسب للأرشفة الذاتية أو الفحص."
              : "A file you can open and read. Good for self-hosting or inspection."}
          </p>
        </section>

        <section aria-labelledby="full-export-enc">
          <h3 id="full-export-enc" className="text-label">
            {ar ? "نسخة مشفّرة للنقل بين الأجهزة" : "Encrypted archive for moving devices"}
          </h3>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{ar ? "عبارة المرور" : "Passphrase"}</span>
              <Input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={ar ? "عبارة مرور للنسخة المشفّرة" : "Passphrase for the archive"}
                autoComplete="new-password"
              />
            </label>
            <Button type="button" onClick={() => void exportEncrypted()} disabled={phase === "working"}>
              <Lock className="size-4" />
              {ar ? "تصدير مشفّر" : "Export encrypted"}
            </Button>
          </div>
          <p className="mt-1 text-caption">
            {ar
              ? "مضغوطة ثم مشفّرة AES-256-GCM. لن نستطيع استعادتها إذا فقدت العبارة."
              : "Gzipped then encrypted with AES-256-GCM. We cannot recover it if you lose the passphrase."}
          </p>
        </section>

        <section aria-labelledby="full-export-in" className="border-t pt-4">
          <h3 id="full-export-in" className="text-label">
            {ar ? "استيراد" : "Import"}
          </h3>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.pmx,application/json"
            className="sr-only"
            onChange={(event) => void pickFile(event.target.files?.[0], passphrase)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              {ar ? "اختيار ملف" : "Choose a file"}
            </Button>
            {phase === "working" && (
              <span className="text-xs text-muted-foreground" role="status">
                {ar ? "جارٍ التحقق..." : "Checking..."}
              </span>
            )}
          </div>
          <p className="mt-1 text-caption">
            {ar
              ? "اختر ملف نسخة. إن كان مشفّراً اكتب كلمة المرور أعلاه قبل الاختيار."
              : "Pick an archive file. If it is encrypted, enter the passphrase above first."}
          </p>
        </section>

        {plan && (
          <div
            className="rounded-xl border border-border bg-muted/40 p-3 text-sm"
            role="region"
            aria-label={ar ? "خطة الاستيراد" : "Import plan"}
          >
            <p className="font-medium">{ar ? "ما سيتغير بعد الاستيراد" : "What importing will change"}</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>
                {ar
                  ? `${plan.incomingConversations} محادثة في الملف (${plan.incomingMessages} رسالة)`
                  : `${plan.incomingConversations} conversations in the file (${plan.incomingMessages} messages)`}
              </li>
              <li>
                {ar
                  ? `${plan.addedConversations} جديدة، ${plan.replacedConversations} ستُحدَّث، ${plan.keptLocalConversations} تبقى كما هي`
                  : `${plan.addedConversations} new, ${plan.replacedConversations} updated, ${plan.keptLocalConversations} kept`}
              </li>
              <li>
                {ar
                  ? `${plan.addedRecords} ذكرى جديدة من ${plan.incomingRecords}`
                  : `${plan.addedRecords} new memories out of ${plan.incomingRecords}`}
              </li>
            </ul>
            {plan.isEmpty && (
              <p className="mt-2 text-xs text-status-attention">
                {ar ? "لا يوجد جديد: كل شيء في الملف موجود بالفعل." : "Nothing new: everything in the file is already here."}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={confirmImport} disabled={plan.isEmpty}>
                {ar ? "تأكيد الاستيراد" : "Confirm import"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={reset}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <p
            role="status"
            className={`flex items-start gap-2 text-sm ${
              notice.tone === "error" ? "text-destructive" : "text-status-success"
            }`}
          >
            {notice.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            )}
            {notice.text}
          </p>
        )}
      </div>
    </SurfaceCard>
  );
}

