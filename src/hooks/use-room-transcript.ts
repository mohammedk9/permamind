"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { openMessage, sealMessage, type RoomKeyHandle, type RoomMessagePayload } from "@/lib/rooms/crypto";
import { presenceLabel } from "@/lib/rooms/presence";
import { roomFeedTopic } from "@/lib/rooms/realtime";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** A message after local decryption. */
export interface DecryptedMessage {
  id: string;
  seq: number;
  body: string;
  alias: string | null;
  replyToId: string | null;
  threadRootId: string | null;
  isMine: boolean;
  isAi: boolean;
  /** Which model wrote an `ai` message, and the role the host gave it. Null on human rows. */
  modelLabel: string | null;
  modelSpecialty: string | null;
  pinned: boolean;
  createdAt: string;
}

/**
 * How often the transcript is re-read while the tab is visible.
 *
 * This is now a safety net rather than the primary mechanism: a Realtime signal normally
 * prompts the re-read, and this covers a signal that was dropped, a client that
 * subscribed while offline, or a channel that never opened. It is deliberately slower
 * than the four seconds it used to be, because a room that is healthy no longer needs
 * asking.
 */
const POLL_MS = 20_000;

interface ServerMessage {
  id: string;
  seq: number;
  ciphertext: string;
  kind: "human" | "ai" | "system";
  /** Present on every `ai` row. Cleartext, and not room content. */
  modelLabel: string | null;
  modelSpecialty: string | null;
  pinnedAt: string | null;
  replyToId: string | null;
  threadRootId: string | null;
  createdAt: string;
  /** Decided by the server, which is the only side that can compare the hashes. */
  isMine: boolean;
}

export interface UseRoomTranscript {
  messages: DecryptedMessage[];
  role: "host" | "trusted" | "guest" | null;
  /** The host's room-wide write switch, so the composer can disable itself. */
  allowGuestWrite: boolean;
  loading: boolean;
  error: string;
  /** True while the Realtime channel is open, so the poll is only a safety net. */
  live: boolean;
  /**
   * Presence labels of the tabs currently in the room, including this one.
   *
   * These are the random per-tab labels from `lib/rooms/presence` and nothing else. Turning
   * a label into a name needs the sealed roster, which only the host is served, so a caller
   * that is not the host can count this list and do nothing more with it.
   */
  presence: string[];
  /**
   * The roles the host offered this room's model, and how many models it may run at once.
   *
   * Empty for every room whose host never filled the field in, which is every room that
   * predates this and most rooms since. The member's question goes out with no speciality,
   * exactly as it did before.
   */
  aiSpecialties: string[];
  aiMaxModels: number | null;
  /** The role this member's questions are sent under. Null means "no role offered". */
  specialty: string | null;
  setSpecialty: (specialty: string | null) => void;
  /**
   * Which kind of room this is. `"guest"` for every room that has never heard of panels, and
   * the panel UI renders on that basis — so a stale or older server response degrades to the
   * room it always was rather than to a broken screen.
   */
  roomKind: "guest" | "panel";
  /**
   * This member's own panel registration, or null when they have registered none.
   *
   * Null is a normal state, not an error: a member who takes part without spending their key
   * is taking part. The server refuses them a model invocation, and the room says so.
   */
  callerModel: { modelId: string; modelLabel: string; specialty: string } | null;
  /**
   * Registers or replaces this member's own model, and withdraws it.
   *
   * Neither can name somebody else's model — the endpoint has no parameter that would accept
   * one — and both resolve by re-reading the transcript, so what the screen shows after the
   * call is what the server actually stored rather than what this tab hoped.
   */
  registerModel: (input: {
    modelId: string;
    modelLabel: string;
    specialty: string;
  }) => Promise<unknown>;
  withdrawModel: () => Promise<unknown>;
  /** True while either call is in flight. Both controls disable on it. */
  panelBusy: boolean;
  /** The last panel failure, already phrased for display by the server. */
  panelError: string;
  /**
   * Sends one message.
   *
   * `replyToId` and `threadRootId` are separate because they mean different things: the
   * first is the message directly above, the second is the message that started the branch.
   * The server defaults the root to the reply target when only one is sent, so a plain reply
   * needs one argument and a reply-to-a-reply needs both.
   */
  send: (
    body: string,
    replyToId?: string | null,
    threadRootId?: string | null,
  ) => Promise<boolean>;
  sendModelAnswer: (
    body: string,
    modelLabel: string,
    modelSpecialty: string | null,
  ) => Promise<boolean>;
  sending: boolean;
  /** Pins or unpins one message. Refused by the server for anyone but the host. */
  setPinned: (messageId: string, pinned: boolean) => Promise<boolean>;
}

/**
 * Reads the presence keys off a subscribed channel.
 *
 * Returns the keys rather than the full presence payload because the payload carries
 * whatever each peer chose to announce. Nothing here is trusted or forwarded: the caller only
 * ever uses the keys as identifiers, and only the host can resolve one to a name.
 */
function readPresenceLabels(
  channel: { presenceState: () => Record<string, unknown[]> } | null,
): string[] {
  if (!channel) return [];
  try {
    return Object.keys(channel.presenceState());
  } catch {
    // A channel that never finished subscribing has no presence state yet.
    return [];
  }
}

/**
 * Holds the decrypted transcript for one room.
 *
 * Decryption happens here, in the browser, with a key that came from the host's device.
 * The server stored ciphertext and never held the key, so this hook is the first and
 * only place the plaintext exists.
 *
 * A message that fails to decrypt is dropped rather than rendered as an error. That
 * happens when the key does not match, which is a real case: a host who closes the tab
 * and reopens the room generates a new key, and every earlier message is then
 * unreadable. A wall of "could not decrypt" would be noise; an empty room is honest.
 */
export function useRoomTranscript(
  roomId: string,
  roomKey: RoomKeyHandle | null,
  memberToken: string | null,
  // The display name this member chose at the door. It is encrypted into every payload
  // they send rather than sent as a column, so the server can enforce that a name exists
  // without ever learning what it was.
  alias: string,
): UseRoomTranscript {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [role, setRole] = useState<"host" | "trusted" | "guest" | null>(null);
  const [allowGuestWrite, setAllowGuestWrite] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const [feedId, setFeedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [presence, setPresence] = useState<string[]>([]);
  const [aiSpecialties, setAiSpecialties] = useState<string[]>([]);
  const [aiMaxModels, setAiMaxModels] = useState<number | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  // Which kind of room this is, and the caller's own model in a panel. Both come from the
  // transcript response rather than a second request, so the panel controls can render with
  // the first paint instead of flashing empty and then filling in.
  const [roomKind, setRoomKind] = useState<"guest" | "panel">("guest");
  const [callerModel, setCallerModel] = useState<{
    modelId: string;
    modelLabel: string;
    specialty: string;
  } | null>(null);

  // A CryptoKey cannot be compared by value, so it is held in a ref and read at use
  // time rather than listed as an effect dependency that changes every render.
  const keyRef = useRef<RoomKeyHandle | null>(roomKey);
  keyRef.current = roomKey;

  const refresh = useCallback(async () => {
    if (!memberToken) return;
    try {
      const response = await fetch(
        `/api/rooms/messages?roomId=${encodeURIComponent(roomId)}`,
        { headers: { "x-room-member": memberToken }, cache: "no-store" },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The transcript could not be loaded.");
        setLoading(false);
        return;
      }

      const data = (await response.json()) as {
        messages: ServerMessage[];
        role: "host" | "trusted" | "guest";
        allowGuestWrite?: boolean;
        aiSpecialties?: string[];
        aiMaxModels?: number | null;
        roomKind?: "guest" | "panel";
        callerModel?: { modelId: string; modelLabel: string; specialty: string } | null;
        feedId?: string | null;
      };
      setRole(data.role);
      setAllowGuestWrite(data.allowGuestWrite !== false);
      setFeedId(data.feedId ?? null);
      // Anything other than the literal "panel" is a guest room, so a server that predates
      // the column — or a cached response from before it existed — leaves the UI as it was.
      setRoomKind(data.roomKind === "panel" ? "panel" : "guest");
      setCallerModel(data.callerModel ?? null);

      const offered = Array.isArray(data.aiSpecialties) ? data.aiSpecialties : [];
      setAiSpecialties(offered);
      setAiMaxModels(typeof data.aiMaxModels === "number" ? data.aiMaxModels : null);
      // A stored choice that the room no longer offers is dropped rather than kept. A host
      // cannot edit the list after creation, but the fallback costs nothing and stops a stale
      // value from ever being sent.
      setSpecialty((current) => (current && offered.includes(current) ? current : null));

      setError("");

      const key = keyRef.current;
      if (!key) {
        setMessages([]);
        setLoading(false);
        return;
      }

      const decoded: DecryptedMessage[] = [];
      for (const row of data.messages) {
        try {
          const payload = await openMessage(row.ciphertext, key);
          decoded.push({
            id: row.id,
            seq: row.seq,
            body: payload.body,
            alias: payload.alias ?? null,
            replyToId: row.replyToId,
            threadRootId: row.threadRootId,
            isMine: row.isMine,
            isAi: row.kind === "ai",
            // Attribution, carried straight from the row. It is not decrypted because it is
            // not room content: it is the label the host gave a model, and the room already
            // knows it out loud.
            modelLabel: row.modelLabel,
            modelSpecialty: row.modelSpecialty,
            pinned: row.pinnedAt !== null,
            createdAt: row.createdAt,
          });
        } catch {
          // Undecryptable, so not shown. See the note on the function above.
        }
      }
      setMessages(decoded);
    } catch {
      setError("The transcript could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [roomId, memberToken]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!memberToken) return;
    const timer = window.setInterval(() => {
      // Polling only while the tab is visible: a background tab re-reading a
      // transcript it cannot render is wasted work.
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, memberToken]);

  // The Realtime subscription.
  //
  // It exists to say "re-read the transcript", never to carry a message. That is what
  // lets a guest with no Supabase account use it at all: there is no session to
  // authorise here, and nothing arrives on this channel that the member token would not
  // have to authorise again on `/api/rooms/messages` regardless.
  //
  // `refresh` is read through a ref rather than listed as a dependency, so that a new
  // closure on every render does not tear down and rebuild the socket.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!feedId) return;
    let channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null =
      null;
    let cancelled = false;

    try {
      const supabase = getSupabaseBrowserClient();
      channel = supabase
        .channel(roomFeedTopic(feedId), {
          config: {
            broadcast: { self: false },
            // A random per-tab label, NOT a slice of the member token. See
            // `lib/rooms/presence` for why a token fragment must never appear on a channel
            // with no authorisation check of its own.
            presence: { key: presenceLabel() },
          },
        })
        .on("broadcast", { event: "changed" }, () => {
          void refreshRef.current();
        })
        .on("presence", { event: "sync" }, () => {
          // Re-read on every sync. Supabase emits one when a peer arrives and one when it
          // leaves, and both change the list the header renders.
          setPresence(readPresenceLabels(channel));
          void refreshRef.current();
        })
        .on("presence", { event: "join" }, () => {
          setPresence(readPresenceLabels(channel));
        })
        .on("presence", { event: "leave" }, () => {
          setPresence(readPresenceLabels(channel));
        })
        .subscribe((status) => {
          if (cancelled) return;
          // CHANNEL_ERROR and TIMED_OUT mean the socket is not usable. supabase-js
          // reconnects on its own, and the poll covers the gap until it does.
          setLive(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") void refreshRef.current();
        });
    } catch {
      // No Supabase configured, or the browser refused the socket. The poll still runs.
      setLive(false);
    }

    return () => {
      cancelled = true;
      setLive(false);
      if (channel) {
        try {
          void getSupabaseBrowserClient().removeChannel(channel);
        } catch {
          // The tab is going away; nothing to release.
        }
      }
    };
  }, [feedId, memberToken]);

  /**
   * The one path every message takes, human or model.
   *
   * It exists because a model answer and a member's message differ in exactly one way — the
   * `kind` and the attribution beside it — and having two implementations of "seal, post,
   * refresh" is how those two drift apart. They previously did: model answers were being
   * posted as human messages, so the transcript could not tell them apart at all.
   */
  const post = useCallback(
    async (
      body: string,
      options: { replyToId?: string | null; threadRootId?: string | null; alias?: string },
      kind: "human" | "ai",
      attribution: { modelLabel: string; modelSpecialty: string | null } | null,
    ): Promise<boolean> => {
      const key = keyRef.current;
      const trimmed = body.trim();
      if (!key || !memberToken || !trimmed) return false;

      const replyToId = options.replyToId ?? null;
      const threadRootId = options.threadRootId ?? null;

      setSending(true);
      try {
        const payload: RoomMessagePayload = {
          body: trimmed,
          replyToId: replyToId ?? undefined,
          // A model answer carries no alias. It is attributed by the cleartext columns, and
          // putting a name in the sealed payload as well would mean two names that could
          // disagree — one the client shows and one the server stored.
          alias: kind === "ai" ? undefined : options.alias,
        };
        const sealed = await sealMessage(payload, key);
        const response = await fetch("/api/rooms/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-room-member": memberToken,
          },
          body: JSON.stringify({
            roomId,
            ciphertext: sealed.ciphertext,
            contentHash: sealed.contentHash,
            kind,
            replyToId,
            // Sent only when it differs from the reply target. A null here would be
            // overwritten by the server's own default, so sending it is harmless but
            // omitting it keeps the request honest about what the client decided.
            threadRootId: threadRootId && threadRootId !== replyToId ? threadRootId : undefined,
            modelLabel: attribution?.modelLabel ?? undefined,
            modelSpecialty: attribution?.modelSpecialty ?? undefined,
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "That message could not be sent.");
          return false;
        }
        setError("");
        await refresh();
        return true;
      } catch {
        setError("That message could not be sent.");
        return false;
      } finally {
        setSending(false);
      }
    },
    [roomId, memberToken, refresh],
  );

  const send = useCallback(
    async (
      body: string,
      replyToId: string | null = null,
      threadRootId: string | null = null,
    ) =>
      post(
        body,
        {
          replyToId,
          threadRootId,
          // Section 4: the name rides inside the encrypted payload, never as a column.
          alias: alias.trim() || undefined,
        },
        "human",
        null,
      ),
    [post, alias],
  );

  /**
   * Posts a model answer, attributed to a model and a role.
   *
   * The alias is deliberately the model's display name and nothing else. The room transcript
   * supplies the speaker name on a human row; on a model row the name lives in the cleartext
   * columns the server validates, so the two can never disagree.
   */
  const sendModelAnswer = useCallback(
    async (
      body: string,
      modelLabel: string,
      modelSpecialty: string | null,
    ): Promise<boolean> =>
      post(body, {}, "ai", { modelLabel, modelSpecialty }),
    [post],
  );

  /**
   * Pins or unpins one message.
   *
   * This sends no ciphertext and touches no room key: pinning is a structural fact about a
   * message, not part of its content, so it lives in a cleartext column the server can write
   * on its own. That is why it does not go through `sealMessage` — sealing a pin would mean
   * only the host could read the room's own agenda.
   *
   * The local transcript is not patched optimistically. A failed pin leaves the message
   * exactly as it was, which is the honest outcome: a pin that appears and then vanishes is
   * worse than one that never appeared, because the room has already seen it.
   */
  const setPinned = useCallback(
    async (messageId: string, pinned: boolean) => {
      if (!memberToken) return false;
      try {
        const response = await fetch("/api/rooms/messages", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-room-member": memberToken,
          },
          body: JSON.stringify({ roomId, messageId, pinned }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "That message could not be pinned.");
          return false;
        }
        setError("");
        await refresh();
        return true;
      } catch {
        setError("That message could not be pinned.");
        return false;
      }
    },
    [roomId, memberToken, refresh],
  );

  // ## Panel: bring a model, or take it away
  //
  // Both act on the caller's own row and nothing else, because the endpoint has no parameter
  // that could name somebody else's. The UI offers a model from the list and a speciality
  // from the host's; neither is free text, because the server refuses both if they are.
  //
  // On success the transcript is re-read rather than the local state patched. The server is
  // the authority on what was stored, and a member who hit the host's cap must see the room
  // as it now is — not as this tab hoped it was.
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState("");

  const panelCall = useCallback(
    async (method: "POST" | "DELETE", body?: Record<string, unknown>) => {
      if (panelBusy || !memberToken) return;
      setPanelBusy(true);
      setPanelError("");
      try {
        const response = await fetch(`/api/rooms/panel?roomId=${encodeURIComponent(roomId)}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-room-member": memberToken,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setPanelError(data.error ?? "That model could not be saved.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setPanelError("That model could not be saved.");
        return false;
      } finally {
        setPanelBusy(false);
      }
    },
    [memberToken, panelBusy, refresh, roomId],
  );

  const registerModel = useCallback(
    (input: { modelId: string; modelLabel: string; specialty: string }) =>
      panelCall("POST", input),
    [panelCall],
  );

  const withdrawModel = useCallback(() => panelCall("DELETE"), [panelCall]);

  return {
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
  };
}
