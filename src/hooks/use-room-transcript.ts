"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { openMessage, sealMessage, type RoomKeyHandle, type RoomMessagePayload } from "@/lib/rooms/crypto";
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
  send: (body: string, replyToId?: string | null) => Promise<boolean>;
  sending: boolean;
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
): UseRoomTranscript {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [role, setRole] = useState<"host" | "trusted" | "guest" | null>(null);
  const [allowGuestWrite, setAllowGuestWrite] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const [feedId, setFeedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);

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
        feedId?: string | null;
      };
      setRole(data.role);
      setAllowGuestWrite(data.allowGuestWrite !== false);
      setFeedId(data.feedId ?? null);
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
          config: { broadcast: { self: false }, presence: { key: memberToken?.slice(0, 16) } },
        })
        .on("broadcast", { event: "changed" }, () => {
          void refreshRef.current();
        })
        .on("presence", { event: "sync" }, () => {
          // Presence state is read on demand by the caller; this only exists so the
          // channel negotiates presence rather than dropping the subscription.
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

  const send = useCallback(
    async (body: string, replyToId: string | null = null) => {
      const key = keyRef.current;
      const trimmed = body.trim();
      if (!key || !memberToken || !trimmed) return false;

      setSending(true);
      try {
        const payload: RoomMessagePayload = {
          body: trimmed,
          replyToId: replyToId ?? undefined,
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
            replyToId,
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

  return { messages, role, allowGuestWrite, loading, error, live, send, sending };
}
