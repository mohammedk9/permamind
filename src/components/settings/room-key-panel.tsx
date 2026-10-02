"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useLocale } from "@/hooks/use-locale";
import { useApiSettings } from "@/hooks/use-api-settings";

/**
 * Option B: the key kept on our servers so a room can answer without the host.
 *
 * Section 5 makes three promises about a stored key, and this panel is where a host acts on
 * the third one. It shows the end date rather than hiding it, and it deletes on click
 * without a confirm step — a confirmation between a person and the exact action they came
 * here to take is friction with no safety gained, since the button says what it does.
 *
 * The key itself is never fetched back. `GET /api/rooms/key` returns an existence flag and a
 * date, because drawing a status line does not require holding a credential in browser
 * memory, and returning the key would put it somewhere it is not needed.
 */
export function RoomKeyPanel() {
  const ar = useLocale().locale === "ar";
  const { apiKey, hydrated } = useApiSettings();
  const [present, setPresent] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rooms/key", { cache: "no-store" });
      // A signed-out visitor gets 401 here. That is not an error worth showing: the panel
      // simply has nothing to manage for them.
      if (!response.ok) return;
      const data = (await response.json()) as { present?: boolean; expiresAt?: string | null };
      setPresent(Boolean(data.present));
      setExpiresAt(data.expiresAt ?? null);
    } catch {
      // Offline. The previous state is left alone rather than claiming the key is gone,
      // because "we could not reach the server" is not the same as "it is deleted".
    }
  }, []);

  useEffect(() => {
    if (hydrated) void load();
  }, [hydrated, load]);

  const store = async () => {
    if (!apiKey?.trim() || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/rooms/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey: apiKey,
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (ar ? "تعذّر حفظ المفتاح." : "The key could not be saved."));
        return;
      }
      setMessage(ar ? "تم الحفظ." : "Saved.");
      await load();
    } catch {
      setError(ar ? "تعذّر حفظ المفتاح." : "The key could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/rooms/key", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (ar ? "تعذّر حذف المفتاح." : "The key could not be removed."));
        return;
      }
      setMessage(ar ? "حُذف المفتاح." : "The key was removed.");
      await load();
    } catch {
      setError(ar ? "تعذّر حذف المفتاح." : "The key could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SurfaceCard
      title={ar ? "مفتاح الغرفة" : "Room key"}
      description={
        ar
          ? "احفظ مفتاحك مشفّراً على خوادمنا ليعمل النموذج في غرفتك حتى بعد إغلاقك جهازك."
          : "Keep your key encrypted on our servers so the model keeps working in a room after you close your laptop."
      }
    >
      <div className="space-y-3 text-sm">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="text-xs text-muted-foreground">
            {ar
              ? "يُشفَّر المفتاح بمفتاح لا يُخزَّن في قاعدة البيانات إطلاقاً، فنسخة منها وحدها لا تكفي لفكّه. يُستخدم فقط للتوقيع، ويُحذف في التاريخ أدناه."
              : "The key is sealed with a key that is never stored in the database, so a dump of it alone cannot open it. It is used only to sign requests, and it is deleted on the date below."}
          </span>
        </p>

        {present ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <span className="font-medium text-foreground">
                {ar ? "مفتاح محفوظ" : "A key is stored"}
              </span>
              <span className="ms-2 text-muted-foreground">
                {expiresAt
                  ? ar
                    ? `يُحذف في ${new Date(expiresAt).toLocaleDateString("ar")}`
                    : `deleted on ${new Date(expiresAt).toLocaleDateString()}`
                  : null}
              </span>
            </p>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-attention" />
              <span>
                {ar
                  ? "حذفه يوقف النموذج في كل غرفة تعتمد عليه. المحادثات تبقى كما هي."
                  : "Removing it stops the model in every room that relied on it. Transcripts are kept."}
              </span>
            </p>
            <Button size="sm" variant="outline" onClick={remove} disabled={busy}>
              <KeyRound className="size-4" />
              {ar ? "احذف مفتاح الغرفة" : "Remove room key"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {ar
                ? "لا يوجد مفتاح محفوظ. بدونه يعمل النموذج ما دمت في الغرفة."
                : "No key is stored. Without one, the model works while you are in the room."}
            </p>
            <Button size="sm" variant="outline" onClick={store} disabled={busy || !apiKey?.trim()}>
              <KeyRound className="size-4" />
              {ar ? "احفظ مفتاحك لسبعة أيام" : "Store my key for seven days"}
            </Button>
            {!apiKey?.trim() ? (
              <p className="text-xs text-muted-foreground">
                {ar ? "أضف مفتاح مزوّد أولاً." : "Add a provider key first."}
              </p>
            ) : null}
          </div>
        )}

        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
