"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RoomMembersPanel } from "@/components/rooms/room-members-panel";
import { RoomHostControls } from "@/components/rooms/room-host-controls";
import { PanelModelControls } from "@/components/rooms/panel-model-controls";
import { IdeasBoard } from "@/components/rooms/ideas-board";
import { RoomReportExport } from "@/components/rooms/room-report-export";
import {
  RoomPresenceStrip,
  sealAliasAtJoin,
} from "@/components/rooms/room-presence-strip";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import { useApiSettings } from "@/hooks/use-api-settings";
import { useLocale } from "@/hooks/use-locale";
import { useRoomTranscript, type DecryptedMessage } from "@/hooks/use-room-transcript";
import { useRoomIdeas } from "@/hooks/use-room-ideas";
import { useRoomModels } from "@/hooks/use-room-models";
import { ModelAddressPicker } from "@/components/rooms/model-address-picker";
import { RoomFilePicker } from "@/components/rooms/room-file-picker";
import { ModelSharingControls } from "@/components/rooms/model-sharing-controls";
import { isValidInviteCode, isValidRoomId } from "@/lib/rooms/access";
// The context window, imported rather than repeated. The route enforces the same bound and
// refused longer requests, so two independent numbers here is what broke "Ask the model" in
// long rooms.
import { ROOM_CONTEXT_MESSAGES } from "@/lib/rooms/ai-bridge";
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

/**
 * Shortens a body for a quote strip.
 *
 * The quoted text is the reader's own decrypted plaintext, so there is nothing to protect
 * here; the reason to cut it is that a reply to a long message would otherwise reprint the
 * whole thing above the reply and push the conversation off screen. The cut is on characters
 * rather than words because a mid-word cut inside a quoted line reads as a deliberate
 * ellipsis, while a word-boundary cut of a single very long word would not.
 */
function truncate(body: string, limit: number): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

export default function RoomDoorPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const { locale } = useLocale();
  const ar = locale === "ar";

  const roomId = typeof params?.roomId === "string" ? params.roomId : "";
  const [code, setCode] = useState("");
  // Section 4: a display name is asked of every guest, because a room full of "Guest 4f2"
  // cannot be moderated. It is not sent to the server as a field; it is encrypted into each
  // message payload, which is what lets the server be told a name exists without reading it.
  // The host is never asked for one: they own the room and do not choose a name for themselves.
  const [alias, setAlias] = useState("");

  // The host's own summary of what this room decided.
  //
  // Held in component state and never persisted: it exists to go into an exported file the
  // host keeps. A summary stored in the room would be deleted along with everything else,
  // which is correct — and is exactly why this is a textarea the host fills in, rather than
  // something the system decided was worth remembering.
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{
    token: string;
    key: RoomKeyHandle;
    // Held in the tab and joined to every message payload, so the name travels encrypted
    // rather than as a column the server could read.
    alias: string;
  } | null>(null);

  const roomKnown = isValidRoomId(roomId);

  if (session) {
    return (
      <RoomTranscript
        roomId={roomId}
        token={session.token}
        roomKey={session.key}
        alias={session.alias}
        ar={ar}
      />
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
    setSession({
      token: result.memberToken,
      key: result.key,
      // Trimmed here rather than on every message: an empty name falls back to the
      // generated "Guest xxxx" label at render time, per section 4's optional alias.
      alias: alias.trim().slice(0, 40),
    });

    // The name is sealed once, here, and never again: a member keeps the name they chose at
    // the door until they leave. Sealing at join rather than at first speech is what lets the
    // host see who is in the room, not only who has spoken. Fire-and-forget — the room is
    // already open, and a failed seal costs the host a display name and nothing else.
    void sealAliasAtJoin({
      roomId,
      memberToken: result.memberToken,
      roomKey: result.key,
      alias,
    });
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

              {/* Section 4: a display name is required by default, and it is asked here
                  rather than on the first message. The design's reason is that a room of
                  "Guest 4f2" cannot be moderated, and a brainstorm needs to know who argued what;
                  asking inside the composer would leave the opening messages under a
                  placeholder while everyone waits.

                  It is not submitted as a field. It is encrypted into each message payload, which
                  is what lets the server be told a name exists without ever reading it. */}
              <div>
                <label
                  htmlFor="room-alias"
                  className="mb-1.5 block text-sm font-medium"
                >
                  {ar ? "اسمك في الغرفة" : "Your name in the room"}
                </label>
                <Input
                  id="room-alias"
                  value={alias}
                  onChange={(event) => {
                    setAlias(event.target.value.slice(0, 40));
                    setError("");
                  }}
                  placeholder={ar ? "مثال: سارة" : "e.g. Sarah"}
                  maxLength={40}
                  autoComplete="nickname"
                  disabled={busy}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {ar
                    ? "يظهر لأعضاء الغرفة فقط ومشفر مع رسائلك."
                    : "Visible to the room only, and encrypted together with your messages."}
                </p>
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
  alias,
  ar,
}: {
  roomId: string;
  token: string;
  roomKey: RoomKeyHandle;
  /** The display name this member chose, encrypted into every payload they send. */
  alias: string;
  ar: boolean;
}) {
  // The host's own summary of what this room decided, and the report it becomes.
  //
  // Held here and never persisted anywhere: it exists to go into a file the host keeps. A
  // summary stored in the room would be deleted with everything else, which is correct — and
  // is exactly why it is a textarea the host fills in rather than something the system
  // decided was worth remembering.
  const [decisionSummary, setDecisionSummary] = useState("");
  const {
    messages,
    role,
    allowGuestWrite,
    loading,
    error,
    live,
    presence,
    aiSpecialties,
    aiMaxModels,
    specialty,
    setSpecialty,
    roomKind,
    callerModel,
    registerModel,
    withdrawModel,
    panelBusy,
    panelError,
    send,
    sending,
    sendModelAnswer,
    setPinned,
  } = useRoomTranscript(roomId, roomKey, token, alias);

  // The room's models, and which one this member is addressing. Separate from the
  // transcript hook because a model answers a question rather than joining a conversation.
  const models = useRoomModels(roomId, token);

  // The ideas board. Separate from the transcript hook because it has its own lifecycle:
  // ideas are sealed and opened on their own schedule, and a board that failed to load
  // must not take the conversation with it.
  const ideas = useRoomIdeas(roomId, token, roomKey);

  // Section 4: a member who gave no name is shown as "Guest xxxx", where the suffix is
  // derived from their own member token. It is shown to the same room that already sees
  // their messages, it is never sent anywhere, and it is not the stored hash — so it
  // identifies nothing outside this conversation.
  const memberLabel = `${ar ? "ضيف" : "Guest"} ${token.slice(0, 4)}`;

  // ## What the report carries about who was here
  //
  // Distinct display names only, and only from messages — not from the roster, and not from
  // presence. A report outlives the room, so it must not carry anything the room itself would
  // not have shown: the roster is host-only, and a member who left is still a member of the
  // transcript.
  const contributorNames = useMemo(
    () =>
      [...new Set(messages.map((m) => m.alias).filter((a): a is string => Boolean(a)))].slice(0, 50),
    [messages],
  );

  // How long the room has existed, measured from its first message.
  //
  // Approximate by design: the room's own creation time is not on anything the client holds,
  // and a room with no messages has no start to measure from. Zero is the honest answer for
  // an empty room rather than the time since the page loaded.
  const hoursOpen = useMemo(() => {
    const stamps = messages
      .map((m) => new Date(m.createdAt).getTime())
      .filter((value) => !Number.isNaN(value));
    if (stamps.length === 0) return 0;
    const oldest = Math.min(...stamps);
    return Math.max(0, (Date.now() - oldest) / 3_600_000);
  }, [messages]);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  /**
   * The message the composer is replying to, and the thread it belongs to.
   *
   * Two ids, because they answer different questions. `replyToId` is the message directly
   * above, which is what the quote strip shows. `threadRootId` is the message that started
   * the branch, which is what keeps a reply to a reply inside the same thread instead of
   * nesting a new one. When the composer is set from a message that is already a reply, both
   * are carried over; when it is set from a top-level message, the root is that message.
   *
   * The thread root is resolved on the client from the transcript rather than asked of the
   * server, because the server stores both columns and the client already holds the whole
   * decrypted page.
   */
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  /** Which message's pin request is in flight, so only that row disables. */
  const [pinningId, setPinningId] = useState<string | null>(null);

  const startReply = (message: DecryptedMessage) => {
    setReplyingTo({
      ...message,
      // A reply to a reply stays in the original thread.
      threadRootId: message.threadRootId ?? message.id,
    });
  };

  const cancelReply = () => setReplyingTo(null);

  const togglePin = async (message: DecryptedMessage) => {
    setPinningId(message.id);
    try {
      await setPinned(message.id, !message.pinned);
    } finally {
      setPinningId(null);
    }
  };

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
  //
  // In a panel room the rule is different and stricter: a member invokes **their own**
  // registered model, so having no registration means there is nothing to invoke. The button
  // is disabled rather than shown-then-refused, and the panel controls above explain why —
  // "you can take part without spending your key" is a real answer, not a consolation.
  const mayAsk =
    roomKind === "panel" ? Boolean(callerModel) : role === "host" || role === "trusted";
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
          // The role this question is asked under. Null when the host offered none, in which
          // case the answer is simply unattributed by role.
          specialty: specialty ?? undefined,
          // Which model answers, when this member picked one. Null means "mine, or the
          // room's" — and the server resolves it from that, never from this value.
          modelSlot: models.target ?? undefined,
          messages: messages
            // The most recent window, not the whole page. `readMessages` serves up to a hundred
            // messages and every one of them was being sent; the route's own cap then refused
            // the request, so "Ask the model" stopped working in any room that had grown past
            // sixty. Slicing here is what makes a long room answer from its recent end instead
            // of failing outright.
            //
            // The bound is the bridge's, imported rather than repeated, because these two used
            // to be independent numbers that disagreed.
            .slice(-ROOM_CONTEXT_MESSAGES)
            .map((message) => ({
            alias: message.alias,
            body: message.body,
            isAi: message.isAi,
            // Which model wrote an earlier answer, so a follow-up can tell the room which of
            // its models it is now arguing with. Carried as structure, never as prompt text.
            modelLabel: message.modelLabel,
            modelSpecialty: message.modelSpecialty,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setAskError(data.error ?? (ar ? "تعذّر سؤال النموذج." : "The model could not be asked."));
        return;
      }
      const data = (await response.json()) as { answer: string; modelLabel: string };
      setQuestion("");
      // The answer is encrypted like everything else and reaches the room through the same
      // path a human's words do. The model is not a privileged speaker with a side channel —
      // the one thing that makes it a privileged speaker, its name, is stored in the clear
      // and is exactly what the room can already see it is talking to.
      //
      // `sendModelAnswer` rather than `send`, so the row is written as `ai` and the server
      // refuses it if the label is missing. Posting it as a human message was possible until
      // the schema began refusing a human row that named a model.
      await sendModelAnswer(data.answer, data.modelLabel, specialty);
    } catch {
      setAskError(ar ? "تعذّر سؤال النموذج." : "The model could not be asked.");
    } finally {
      setAsking(false);
    }
  };

  // The room's own read-only state, whatever the viewer can do. The host's switch writes it and
  // `refresh` reads it back, so this is the value every other client converges on.
  const roomReadOnly = !allowGuestWrite;

  // The host's optimistic override.
  //
  // Without it, flipping the switch would not change this tab's own composer until the next
  // transcript re-read, and a host who locks a room and can still type into it has been told
  // something false. Null means "whatever the last read said", which is the state every other
  // member is always in.
  const [readOnlyOverride, setReadOnlyOverride] = useState<boolean | null>(null);
  const effectiveReadOnly = readOnlyOverride ?? roomReadOnly;

  // A guest writes by default, per the design; read-only is the host's switch. The server
  // enforces the same rule, so this only decides whether the field is usable.
  const readOnly = role === "guest" && effectiveReadOnly;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !draft.trim()) return;
    // Both ids travel together. The server defaults the root to the reply target when only
    // one is given, so a plain reply works either way; sending both keeps a reply-to-a-reply
    // in the thread it belongs to rather than starting a branch under its own parent.
    const sent = await send(draft, replyingTo?.id ?? null, replyingTo?.threadRootId ?? null);
    // The composer is only cleared once the server has the message. A failed send leaves the
    // draft and the reply target in place so nothing has to be retyped.
    if (sent) {
      setDraft("");
      setReplyingTo(null);
    }
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

        {/* Who is here right now. The host sees names; everyone else sees a number. The
            asymmetry is enforced on the server — `/api/rooms/roster` refuses a guest before
            it queries — so this component is presentation, not the control itself. */}
        <RoomPresenceStrip
          roomId={roomId}
          roomKey={roomKey}
          memberToken={token}
          labels={presence}
          ar={ar}
          isHost={role === "host"}
          alias={alias}
        />
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
            messages.map((message) => {
              // The quoted message, found from the transcript this client already holds. A
              // reply whose target is not in the loaded page renders without a quote rather
              // than as an error: the target may simply be on an earlier page.
              const quoted = message.replyToId
                ? messages.find((candidate) => candidate.id === message.replyToId)
                : undefined;

              return (
                <article
                  key={message.id}
                  className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                    message.isAi
                      ? "border-primary/30 bg-primary/5"
                      : message.isMine
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-card"
                  } ${message.isMine ? "ms-auto" : ""} ${message.pinned ? "ring-1 ring-primary/40" : ""}`}
                >
                  {message.pinned ? (
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
                      {ar ? "مثبّت" : "Pinned"}
                    </p>
                  ) : null}
                  {/* A nameless member renders as "Guest xxxx", derived from their own
                      token rather than declared by them (section 4). Two guests stay
                      distinguishable without either having to claim an identity, and the
                      suffix leaks nothing: it is derived from a value the server already
                      stores only as a hash, and this client never transmits it. */}
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    {/* A model row is attributed by the server-validated columns rather than by
                        the sealed payload, so the name shown is the name that was stored. A
                        human row falls back to the member's own name. */}
                    {message.isAi
                      ? message.modelLabel ?? (ar ? "النموذج" : "The model")
                      : message.alias ?? memberLabel}
                    {/* The role the host gave the model. Nothing renders when the host offered no
                        roles, which is the case for every room that predates this. */}
                    {message.isAi && message.modelSpecialty ? (
                      <span className="ms-1.5 font-normal opacity-70">
                        {ar ? "— " : "· "}
                        {message.modelSpecialty}
                      </span>
                    ) : null}
                  </p>
                  {/* The quoted line is plaintext, because the reader has already decrypted the
                      whole page. Only this client can read it, and only from what it holds. */}
                  {quoted ? (
                    <p className="mb-2 border-s-2 border-primary/40 ps-2 text-xs text-muted-foreground">
                      {quoted.alias ?? memberLabel}: {truncate(quoted.body, 90)}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-sm leading-7">{message.body}</p>

                  {/* Reply is available to everyone who may write; pin is host-only, and is not
                      rendered at all for anyone else rather than shown disabled. A member who
                      cannot pin has no reason to be told the control exists. */}
                  {!readOnly ? (
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startReply(message)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {ar ? "رد" : "Reply"}
                      </button>
                      {role === "host" ? (
                        <button
                          type="button"
                          onClick={() => void togglePin(message)}
                          disabled={pinningId === message.id}
                          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          {message.pinned ? (ar ? "ألغِ التثبيت" : "Unpin") : ar ? "ثبّت" : "Pin"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
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
              {/* The two room kinds must not share this sentence. In a panel room nobody's
                  answers are paid for by the host: each member invokes their own model with
                  their own key, and saying "the host's key" here would be the one place the
                  room states something false about who is paying. */}
              {roomKind === "panel"
                ? ar
                  ? "كل عضو يسأل بنموذجه وبمفتاحه. لا تُنفق غرفة اللوحات مفتاح أحد."
                  : "Every member asks with their own model and their own key. A panel room never spends anyone else's."
                : ar
                  ? "النموذج يعمل بمفتاح المضيف. يستطيع الجميع قراءة ردوده؛ المضيف وأعضاؤه الموثوقون فقط هم من يسألونه."
                  : "The model runs on the host's key. Everyone here can read its answers; only the host and members they trust can ask it questions."}
            </span>
          </div>

          {/* The panel controls, for anyone in a panel room. Rendered above the composer
              rather than inside it, so a member who has not registered a model still reads
              the reason their button is missing. */}
          {roomKind === "panel" ? (
            <>
            <PanelModelControls
              aiSpecialties={aiSpecialties}
              aiMaxModels={aiMaxModels}
              callerModel={callerModel}
              registerModel={registerModel}
              withdrawModel={withdrawModel}
              busy={panelBusy}
              error={panelError}
              ar={ar}
            />
            {/* What this member agreed about their own model, and what it has cost so
                far. Only rendered when they have one, and only for them: a member may see
                their own budget and nobody else's. */}
            <ModelSharingControls
              roomId={roomId}
              memberToken={token}
              model={models.models.find((m) => m.isMine) ?? null}
              onSaved={models.refresh}
              ar={ar}
            />
          </>
          ) : null}
          {/* In a panel room a member with no model has nothing to invoke. The button is
              absent rather than dead, and the controls above already said why — a member
              taking part without spending their key is taking part. */}
          {roomKind === "panel" && !callerModel ? (
            <p className="text-xs text-muted-foreground">
              {ar ? "اسأل بعد أن تسجّل نموذجاً." : "Ask a question once you have brought a model."}
            </p>
          ) : null}

          {mayAsk ? (
            <div className="space-y-2">
              {/* Who answers. Rendered whenever the room has more than one model, and in a
                  panel always. A single-model room needs no picker: there is nothing to
                  choose between, and a disabled control would be decoration. */}
              {models.models.length > 1 || roomKind === "panel" ? (
                <ModelAddressPicker
                  models={models.models}
                  selected={models.target}
                  onSelect={models.setTarget}
                  busy={asking}
                  ar={ar}
                />
              ) : null}
              {/* The role picker. Rendered only when the host offered roles, which is never in
                  a room created before this feature and is left empty by a host who skips it.
                  A member chooses who they are talking to; the host chooses what is on the
                  list. Clicking the chosen role clears it. */}
              {aiSpecialties.length > 0 && roomKind !== "panel" ? (
                // Hidden in a panel room. There the role is not a per-question choice: a
                // member registered their model *with* a role, and letting them pick a
                // different one per question would let someone answer as the critic while
                // being labelled as the marketer. The registration is the authority there.
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {ar ? "الدور:" : "Role:"}
                  </span>
                  {aiSpecialties.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSpecialty(specialty === option ? null : option)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        specialty === option
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}

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

          {replyingTo ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="min-w-0 text-xs text-muted-foreground">
                <span className="font-semibold">
                  {ar ? "ترد على " : "Replying to "}
                  {replyingTo.alias ?? memberLabel}
                </span>
                <span className="block truncate">{truncate(replyingTo.body, 90)}</span>
              </p>
              <button
                type="button"
                onClick={cancelReply}
                aria-label={ar ? "إلغاء الرد" : "Cancel reply"}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                {ar ? "إلغاء" : "Cancel"}
              </button>
            </div>
          ) : null}

          {/* Files. A document is read in the browser and only its text joins the sealed
              message, so nothing is uploaded and the room keeps its single store of
              ciphertext. The control is absent in a read-only room because the room would
              refuse the post anyway, and a button that always fails is worse than none. */}
          {!readOnly ? (
            <div className="px-4 pt-3">
              <RoomFilePicker
                onAttach={(body) => {
                  setDraft("");
                  void send(body);
                }}
                busy={sending}
                ar={ar}
              />
            </div>
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
                  : replyingTo
                    ? ar
                      ? "اكتب ردك…"
                      : "Write a reply…"
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

      {/* The board. Open to every member, a guest included: proposing an idea spends
          nobody's key, so it is not gated the way invoking the model is. Accepting and
          converting are host-only, and that split is section 9's boundary. */}
      {role ? (
      <IdeasBoard
        ideas={ideas.ideas}
        loading={ideas.loading}
        error={ideas.error}
        role={role}
        addIdea={ideas.addIdea}
        vote={ideas.vote}
        setStatus={ideas.setStatus}
        ar={ar}
      />
      ) : null}

      {/* The host's way out, and deliberately a file rather than a memory entry.
          Section 9's warning is that a brainstorm which quietly becomes permanent memory is
          how a memory system fills with noise. So nothing is recorded on the host's behalf:
          the host presses a button and keeps a document they can re-read or throw away. */}
      {role === "host" ? (
        <>
          <div className="px-4 pb-4">
            <label htmlFor="room-decision-summary" className="mb-1.5 block text-sm font-medium">
              {ar ? "ما اتُّفق عليه" : "What was decided"}
            </label>
            <textarea
              id="room-decision-summary"
              value={decisionSummary}
              onChange={(event) => setDecisionSummary(event.target.value.slice(0, 2000))}
              rows={3}
              placeholder={
                ar
                  ? "اكتب خلاصة ما اتُّفق عليه. تذهب إلى التقرير، ولا إلى أي مكان آخر."
                  : "Write what was agreed. This goes into the report, and nowhere else."
              }
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring"
            />
          </div>
          <RoomReportExport
            roomId={roomId}
            summary={decisionSummary}
            ideas={ideas.ideas.map((idea) => ({
              text: idea.text,
              score: idea.score,
              voters: idea.voters,
              status: idea.status,
            }))}
            contributorLabels={contributorNames}
            hoursOpen={hoursOpen}
            locale={ar ? "ar" : "en"}
            ar={ar}
          />
        </>
      ) : null}

      {/* The host's only control over AI spending. Rendering it on `role === "host"`
          rather than merely disabling it elsewhere is deliberate: a guest should not learn
          who else is in the room, and the panel is the roster. */}
      {role === "host" ? (
        <>
          <RoomHostControls
            roomId={roomId}
            memberToken={token}
            readOnly={effectiveReadOnly}
            onReadOnlyChange={setReadOnlyOverride}
            ar={ar}
          />
          <RoomMembersPanel roomId={roomId} memberToken={token} ar={ar} />
        </>
      ) : null}
    </main>
  );
}
