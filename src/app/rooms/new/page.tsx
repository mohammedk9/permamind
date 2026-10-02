"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useLocale } from "@/hooks/use-locale";
import { useApiSettings } from "@/hooks/use-api-settings";
import { downloadJson } from "@/lib/storage/download";
import { prepareNewRoom, roomLink } from "@/lib/rooms/client";

/**
 * Opening a room. Phase 3 of docs/group-rooms-design.md.
 *
 * The room key is created on this page and is never sent anywhere. What leaves is the
 * two codes and the sealed key, which the server stores without being able to open it.
 * That is why the create button is here rather than in a route handler.
 */

/** How long a room may last. There is no "forever", by design. */
const DURATIONS = [
  { hours: 1, en: "1 hour", ar: "ساعة" },
  { hours: 24, en: "24 hours", ar: "يوم" },
  { hours: 168, en: "7 days", ar: "أسبوع" },
];

/** A room cannot outlive a month. */
const MAX_HOURS = 31 * 24;

export default function NewRoomPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { apiKey, provider, modelName, defaultModelId } = useApiSettings();

  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [hours, setHours] = useState(24);
  const [keyMode, setKeyMode] = useState<"browser" | "server">("browser");
  const [keyDays, setKeyDays] = useState(7);
  const [allowGuestWrite, setAllowGuestWrite] = useState(true);
  const [requireDisplayName, setRequireDisplayName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"link" | "invite" | null>(null);
  const [created, setCreated] = useState<{ roomId: string; inviteCode: string; hostCode: string } | null>(null);

  // A room without a model in it is a group chat, which is not what this is for.
  const hasKey = Boolean(apiKey?.trim());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !hasKey) return;
    setError("");

    if (hours > MAX_HOURS) {
      setError(ar ? "لا تتجاوز ٣١ يوماً." : "A room cannot last longer than 31 days.");
      return;
    }

    // The codes and the sealed key are made here, because this is the only side that
    // holds the room key and therefore the only side that can seal it.
    const prepared = await prepareNewRoom();

    // The model is the host's own, from the settings screen. Falling back to
    // `defaultModelId` is not a silent choice: it is the same model the host would use in a
    // private chat on that provider, and the row is only ever written when a usable key
    // exists (see `hasKey`). The earlier `modelName || defaultModelId` was fine; what was
    // missing is that nothing stopped a room being opened on a provider whose model list the
    // host never looked at, which `submit` now guards.
    const model = modelName?.trim() || defaultModelId;

    setBusy(true);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          topic: topic.trim(),
          expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
          aiProvider: provider,
          aiModel: model,
          keyMode,
          keyExpiresAt:
            keyMode === "server"
              ? new Date(Date.now() + keyDays * 86_400_000).toISOString()
              : null,
          allowGuestWrite,
          requireDisplayName,
          inviteCode: prepared.inviteCode,
          hostCode: prepared.hostCode,
          wrappedRoomKey: prepared.wrappedRoomKey,
          wrapSalt: prepared.wrapSalt,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; roomId?: string };

      if (!response.ok || !data.roomId) {
        setError(data.error ?? (ar ? "تعذّر إنشاء الغرفة." : "The room could not be created."));
        return;
      }
      setCreated({ roomId: data.roomId, inviteCode: prepared.inviteCode, hostCode: prepared.hostCode });
    } catch {
      setError(ar ? "تعذّر إنشاء الغرفة." : "The room could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, which: "link" | "invite") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // A blocked clipboard is not worth an error; the value is on screen either way.
    }
  };

  if (created) {
    return (
      <main dir={ar ? "rtl" : "ltr"} className="mx-auto max-w-2xl px-4 py-16">
        <SurfaceCard
          title={ar ? "غرفتك جاهزة" : "Your room is ready"}
          description={
            ar
              ? "انسخ الرابط وأرسله مع رمز الدخول. لا يمكن استرجاع الرمز بعد إغلاق هذه الصفحة."
              : "Copy the link and send it with the code. The code cannot be retrieved after this page closes."
          }
        >
          <div className="space-y-4">
            <CodeField
              label={ar ? "رابط الغرفة" : "Room link"}
              value={roomLink(created.roomId)}
              onCopy={() => copy(roomLink(created.roomId), "link")}
              copied={copied === "link"}
              ar={ar}
            />
            <CodeField
              label={ar ? "رمز الدخول" : "Invite code"}
              value={created.inviteCode}
              onCopy={() => copy(created.inviteCode, "invite")}
              copied={copied === "invite"}
              ar={ar}
              mono
            />

            <div className="rounded-lg border border-status-attention/40 bg-status-attention/10 p-3 text-sm">
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-attention" />
                <span>
                  {ar
                    ? "رمز المضيف يمنحك صلاحيات الإدارة. لا تشاركه."
                    : "Your host code gives you administration over this room. Do not share it."}
                </span>
              </p>
              <p className="mt-2 font-mono text-sm tracking-widest">{created.hostCode}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() =>
                  downloadJson(
                    { roomId: created.roomId, hostCode: created.hostCode, savedAt: new Date().toISOString() },
                    "permamind-room-host-code.json",
                  )
                }
              >
                {ar ? "احفظ رمز المضيف" : "Save my host code"}
              </Button>
            </div>

            <Button type="button" onClick={() => router.push(`/r/${created.roomId}`)}>
              {ar ? "ادخل غرفتك" : "Enter the room"}
            </Button>
          </div>
        </SurfaceCard>
      </main>
    );
  }

  return (
    <main dir={ar ? "rtl" : "ltr"} className="mx-auto max-w-2xl px-4 py-12">
      <PageHeader
        title={ar ? "محادثة جماعية" : "Group room"}
        description={
          ar
            ? "اعصف ذهنياً مع أشخاص ونموذج ذكاء اصطناعي في مكان واحد."
            : "Brainstorm with people and an AI model in one place."
        }
      />

      {!hasKey ? (
        <SurfaceCard
          title={ar ? "أضف مفتاح مزوّد أولاً" : "Add a provider key first"}
          description={
            ar
              ? "الغرفة لا تُفتح بلا مفتاح، لأن النموذج هو ما يجعلها أكثر من دردشة جماعية."
              : "A room cannot be opened without a key, because the model is what makes it more than a group chat."
          }
        >
          <Button type="button" onClick={() => router.push("/settings")}>
            {ar ? "إلى الإعدادات" : "Open settings"}
          </Button>
        </SurfaceCard>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <SurfaceCard title={ar ? "الغرفة" : "The room"}>
            <div className="space-y-4">
              <div>
                <label htmlFor="room-title" className="mb-1.5 block text-sm font-medium">
                  {ar ? "الاسم" : "Name"}
                </label>
                <Input
                  id="room-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={ar ? "إطلاق المنتج" : "Product launch"}
                  maxLength={120}
                />
              </div>
              <div>
                <label htmlFor="room-topic" className="mb-1.5 block text-sm font-medium">
                  {ar ? "الموضوع" : "Topic"}
                </label>
                <textarea
                  id="room-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder={ar ? "ما الذي نقرره؟" : "What are we deciding?"}
                  maxLength={500}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium">
                  {ar ? "متى تنتهي" : "When it ends"}
                </span>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((option) => (
                    <Button
                      key={option.hours}
                      type="button"
                      size="sm"
                      variant={hours === option.hours ? "default" : "outline"}
                      onClick={() => setHours(option.hours)}
                    >
                      {ar ? option.ar : option.en}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {ar
                    ? "لا يوجد خيار للأبد. عند الانتهاء تُحذف الغرفة ومحادثتها."
                    : "There is no forever option. When this ends, the room and its transcript are deleted."}
                </p>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard
            title={ar ? "مفتاح الذكاء الاصطناعي" : "The AI key"}
            description={
              ar
                ? "النموذج يعمل بمفتاحك. أنت من يقرّر أين يُحفظ."
                : "The model runs on your key. You decide where it is kept."
            }
          >
            <div className="space-y-3">
              {/* What the room will actually run on, shown rather than assumed. The host
                  picks these in Settings; this card only confirms them, because the model
                  on the `rooms` row is what every member gets and what the host is billed
                  for. A silent default here would mean a room answering on a model the
                  host never chose, which is the one thing this feature promises not to do. */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  {ar ? "ما الذي ستدفع ثمنه" : "What you will be billed for"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {provider} · <span className="font-mono">{modelName?.trim() || defaultModelId}</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {ar
                    ? "تُغيَّر هذه القيمة من الإعدادات قبل فتح الغرفة."
                    : "Change this in Settings before opening the room."}
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="radio"
                  name="key-mode"
                  className="mt-1"
                  checked={keyMode === "browser"}
                  onChange={() => setKeyMode("browser")}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {ar ? "في المتصفح فقط" : "In this browser only"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {ar
                      ? "لا يغادر جهازك. يعمل النموذج ما دمت في الجلسة."
                      : "It never leaves your device. The model works while you are in the session."}
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="radio"
                  name="key-mode"
                  className="mt-1"
                  checked={keyMode === "server"}
                  onChange={() => setKeyMode("server")}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {ar ? "على خادمنا" : "On our server"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {ar
                      ? "يستمر النموذج بعد إغلاقك جهازك."
                      : "The model keeps answering after you close your laptop."}
                  </span>
                </span>
              </label>

              {keyMode === "server" ? (
                <div className="rounded-lg border border-status-attention/40 bg-status-attention/10 p-3 text-sm">
                  <p className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-attention" />
                    <span>
                      {ar
                        ? "سيُحفظ مفتاحك على خادم PermaMind، مشفّراً. يُستخدم فقط لتوقيع طلبات مزوّدك، ويُحذف في التاريخ الذي تختاره، ويمكنك حذفه في أي وقت من الإعدادات."
                        : "Your key will be stored on PermaMind's server, encrypted. It is used only to sign requests to your provider, it is deleted on the date you pick, and you can remove it from Settings at any time."}
                    </span>
                  </p>
                  <label className="mt-3 block text-xs font-medium">
                    {ar ? "حذف المفتاح بعد" : "Delete the key after"}
                    <select
                      value={keyDays}
                      onChange={(event) => setKeyDays(Number(event.target.value))}
                      className="mt-1 block w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm"
                    >
                      <option value={1}>{ar ? "يوم واحد" : "1 day"}</option>
                      <option value={7}>{ar ? "٧ أيام" : "7 days"}</option>
                      <option value={30}>{ar ? "٣٠ يوماً" : "30 days"}</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </SurfaceCard>

          <SurfaceCard title={ar ? "الضيوف" : "Guests"}>
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allowGuestWrite}
                  onChange={(event) => setAllowGuestWrite(event.target.checked)}
                />
                <span>
                  {ar ? "يسمح للضيوف بالكتابة" : "Let guests write"}
                  {!allowGuestWrite ? (
                    <span className="ms-2 text-xs text-muted-foreground">
                      ({ar ? "قراءة فقط" : "read only"})
                    </span>
                  ) : null}
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={requireDisplayName}
                  onChange={(event) => setRequireDisplayName(event.target.checked)}
                />
                <span>{ar ? "يشترط اسم عرض لكل ضيف" : "Require a display name from each guest"}</span>
              </label>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "الأسماء تُشفَّر داخل الرسائل. لا يقرأها الخادم."
                  : "Names are encrypted inside the messages. The server never reads them."}
              </p>
            </div>
          </SurfaceCard>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {ar ? "أنشئ الغرفة" : "Create room"}
          </Button>
        </form>
      )}
    </main>
  );
}

/** A copyable value, used for the room link and the invite code. */
function CodeField({
  label,
  value,
  onCopy,
  copied,
  ar,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  ar: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm ${mono ? "font-mono text-lg tracking-[0.3em]" : ""}`}
        >
          {value}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={onCopy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          <span className="ms-2">{copied ? (ar ? "تم" : "Copied") : (ar ? "نسخ" : "Copy")}</span>
        </Button>
      </div>
    </div>
  );
}
