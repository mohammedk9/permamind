"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import { useApiSettings } from "@/hooks/use-api-settings";
import { useLocale } from "@/hooks/use-locale";
import { useRoomTranscript } from "@/hooks/use-room-transcript";
import { isValidInviteCode, isValidRoomId } from "@/lib/rooms/access";
import { joinWithCode, type RoomKeyHandle } from "@/lib/rooms/client";

/**
 * The room door. Phase 3 of docs/group-rooms-design.md.
 *
 * No account, no email, no password. A guest arrives from a pasted link, types a
 * six-digit code, and is in. Everything that would normally happen at sign-in happens
 * here instead: the code is exchanged for a member token, and the room key is unwrapped
 * on this device.
 *
 * The code is asked for rather than being part of the link on purpose. A code in a URL
 * ends up in chat logs, in the browser history, and in the referrer of any image the
 * page loads. Keeping it in a field means the only place it exists is this screen.
 */
export default function RoomDoorPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const { locale } = useLocale();
  const ar = locale === "ar";

  const roomId = typeof params?.roomId === "string" ? params.roomId : "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{
    token: string;
    key: RoomKeyHandle;
  } | null>(null);

  const roomKnown = isValidRoomId(roomId);

  if (session) {
    return (
      <RoomTranscript roomId={roomId} token={session.token} roomKey={session.key} ar={ar} />
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!roomKnown || busy) return;
    setError("");

    if (!isValidInviteCode(code.trim())) {
      setError(
        ar
          ? "أدخل الرمز المكوّن من ٦ أرقام."
          : "Enter the six-digit code you were given.",
      );
      return;
    }

    setBusy(true);
    const result = await joinWithCode(roomId, code.trim());
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The key unwrapped successfully, so hold it and show the transcript. Staying on
    // this page rather than navigating matters: the room key lives in memory and would
    // not survive a route change.
    setSession({ token: result.memberToken, key: result.key });
  };

  return (
    <main
      dir={ar ? "rtl" : "ltr"}
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-foreground"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size="sm" withWordmark />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-primary/5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">
                {ar ? "انضم إلى الغرفة" : "Join the room"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {ar ? "لا تحتاج إلى حساب" : "No account needed"}
              </p>
            </div>
          </div>

          {!roomKnown ? (
            <p role="alert" className="text-sm text-destructive">
              {ar
                ? "رابط الغرفة غير صالح. تحقق من الرابط مرة أخرى."
                : "This room link is not valid. Check the link again."}
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
                {ar
                  ? "رمز الدخول يفتح الغرفة. مفتاحك لا يغادر هذا الجهاز، ولا يقرأ أحد ما كتبته."
                  : "The code opens the room. Your key never leaves this device, and nobody can read what you write."}
              </div>

              <div>
                <label
                  htmlFor="room-code"
                  className="mb-1.5 block text-sm font-medium"
                >
                  {ar ? "رمز الدخول" : "Invite code"}
                </label>
                <Input
                  id="room-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="483921"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "room-code-error" : undefined}
                  disabled={busy}
                />
              </div>

              {error ? (
                <p
                  id="room-code-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {ar ? "انضم" : "Join room"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-6 text-muted-foreground">
          {ar
            ? "الغرفة تنتهي في موعدها، وتُحذف محادثتها عند انتهائها. لا يحتفظ الخادم بما كتبته."
            : "The room ends when the host says it does, and its transcript is deleted. We do not keep what you write."}
        </p>
      </div>
    </main>
  );
}

/**
 * The room, once the code is in.
 *
 * Messages arrive as ciphertext and are opened here with the key that came from the
 * host's device. Nothing rendered here was ever readable by the server.
 */
function RoomTranscript({
  roomId,
  token,
  roomKey,
  ar,
}: {
  roomId: string;
  token: string;
  roomKey: RoomKeyHandle;
  ar: boolean;
}) {
  const { messages, role, allowGuestWrite, loading, error, live, send, sending } =
    useRoomTranscript(roomId, roomKey, token);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  // The host's own key, when they are present and holding one. Sending it here is Option A,
  // and it is why the key never reaches our database on this path.
  //
  // When nobody in the tab holds a key — a `trusted` member, or the host after they close
  // their laptop — the request goes without a key header and the route falls back to Option
  // B if the room was opened that way. Nothing here needs to know which happened.
  const { getRequestHeaders } = useApiSettings();
  const aiHeaders = useCallback(
    async (): Promise<Record<string, string>> => getRequestHeaders(),
    [getRequestHeaders],
  );

  // A guest may write but may not invoke the model, per section 4. The server enforces the
  // same rule; this only decides whether the button is usable, so a guest learns why it is
  // missing rather than pressing it and being refused.
  const mayAsk = role === "host" || role === "trusted";
  const askModel = async () => {
    if (asking || !question.trim()) return;
    setAsking(true);
    setAskError("");
    try {
      const headers = await aiHeaders();
      const response = await fetch(`/api/rooms/ai?roomId=${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          messages: messages.map((message) => ({
            alias: message.alias,
            body: message.body,
            isAi: message.isAi,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setAskError(data.error ?? (ar ? "تعذّر سؤال النموذج." : "The model could not be asked."));
        return;
      }
      const data = (await response.json()) as { answer: string };
      setQuestion("");
      // The answer is posted as an ordinary message, which means it is encrypted like
      // everything else and reaches the room through the same path a human's words do.
      // The model is not a privileged speaker with a side channel.
      await send(data.answer);
    } catch {
      setAskError(ar ? "تعذّر سؤال النموذج." : "The model could not be asked.");
    } finally {
      setAsking(false);
    }
  };

  // A guest writes by default, per the design; read-only is the host's switch. The
  // server enforces the same rule, so this only decides whether the field is usable.
  const readOnly = role === "guest" && !allowGuestWrite;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !draft.trim()) return;
    const sent = await send(draft);
    if (sent) setDraft("");
  };

  return (
    <main dir={ar ? "rtl" : "ltr"} className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Logo size="xs" withWordmark />
          <span className="font-mono text-xs text-muted-foreground">{roomId}</span>
        </div>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* Honest about the transport rather than implying it is always live: when the
              socket is down the transcript is still being re-read, just on a timer. */}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            />
            {live ? (ar ? "مباشر" : "Live") : ar ? "متصل" : "Reconnecting…"}
          </span>
          <span>{role === "host" ? (ar ? "المضيف" : "Host") : ar ? "ضيف" : "Guest"}</span>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {ar ? "جارٍ التحميل…" : "Loading…"}
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar
                ? "لا توجد رسائل بعد. اكتب أول رسالة."
                : "No messages yet. Write the first one."}
            </p>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                  message.isAi
                    ? "border-primary/30 bg-primary/5"
                    : message.isMine
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-card"
                } ${message.isMine ? "ms-auto" : ""}`}
              >
                {message.pinned ? (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
                    {ar ? "مثبّت" : "Pinned"}
                  </p>
                ) : null}
                {message.alias ? (
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    {message.alias}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-7">{message.body}</p>
              </article>
            ))
          )}
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-border p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {/* Section 5's transparency line, shown to everyone. It does not say where the key
              is stored, because that is the host's decision and not a guest's business —
              but it never claims the model is free either. */}
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              {ar
                ? "النموذج يعمل بمفتاح المضيف. يستطيع الجميع قراءة ردوده؛ المضيف وأعضاؤه الموثوقون فقط هم من يسألونه."
                : "The model runs on the host's key. Everyone here can read its answers; only the host and members they trust can ask it questions."}
            </span>
          </div>

          {mayAsk ? (
            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={ar ? "اسأل النموذج…" : "Ask the model…"}
                maxLength={4_000}
                disabled={asking}
                aria-label={ar ? "سؤالك للنموذج" : "Your question for the model"}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={askModel}
                disabled={asking || !question.trim()}
                aria-label={ar ? "اسأل النموذج" : "Ask the model"}
              >
                {asking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {ar
                ? "المضيف وأعضاؤه الموثوقون فقط يسألون النموذج. ما زال بإمكانك القراءة والمشاركة."
                : "Only the host and members they trust can ask the model. You can still read and take part."}
            </p>
          )}

          {askError ? (
            <p role="alert" className="text-sm text-destructive">
              {askError}
            </p>
          ) : null}

          <form onSubmit={submit} className="flex gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                role === "guest" && readOnly
                  ? ar
                    ? "هذه الغرفة للقراءة فقط"
                    : "This room is read-only"
                  : ar
                    ? "اكتب رسالة…"
                    : "Write a message…"
              }
              maxLength={4_000}
              disabled={sending || readOnly}
              aria-label={ar ? "رسالتك" : "Your message"}
            />
            <Button type="submit" disabled={sending || !draft.trim() || readOnly}>
              {ar ? "إرسال" : "Send"}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
}
