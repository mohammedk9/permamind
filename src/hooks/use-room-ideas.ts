"use client";

import { useCallback, useEffect, useState } from "react";

import { sealMessage } from "@/lib/rooms/crypto";
import type { RoomKeyHandle } from "@/lib/rooms/crypto";

/**
 * The room's ideas board, as the browser holds it.
 *
 * The server stores each idea sealed and returns the ciphertext. Decryption happens here,
 * because only the browser holds the room key — the same division as the transcript, and the
 * reason an idea is unreadable to a database dump in exactly the way a message is.
 *
 * A row that fails to open is dropped rather than rendered as an error. A single unreadable
 * idea must not take the whole board down, and the alternative — showing a placeholder for
 * every row a future schema change touched — would be worse than showing fewer.
 */
export interface Idea {
  id: string;
  text: string;
  isMine: boolean;
  status: "open" | "accepted" | "dropped";
  taskId: string | null;
  createdAt: string;
  score: number;
  voters: number;
  myVote: -1 | 0 | 1;
}

interface ServerIdea {
  id: string;
  ciphertext: string;
  isMine: boolean;
  status: "open" | "accepted" | "dropped";
  taskId: string | null;
  createdAt: string;
  score: number;
  voters: number;
  myVote: -1 | 0 | 1;
}

export function useRoomIdeas(
  roomId: string,
  memberToken: string,
  roomKey: RoomKeyHandle | null,
) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!memberToken || !roomKey) return;
    try {
      const response = await fetch(`/api/rooms/ideas?roomId=${encodeURIComponent(roomId)}`, {
        headers: { "x-room-member": memberToken },
        cache: "no-store",
      });
      if (!response.ok) {
        setError("The board could not be loaded.");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as { ideas: ServerIdea[] };

      // Opened one at a time and filtered, rather than mapped with a throwing decrypt. A row
      // sealed under a different key, or written by a build whose payload shape changed, costs
      // that row and nothing else.
      const opened: Idea[] = [];
      for (const row of data.ideas ?? []) {
        try {
          const payload = await sealOpen(row.ciphertext, roomKey);
          opened.push({
            id: row.id,
            text: typeof payload === "string" ? payload : "",
            isMine: row.isMine,
            status: row.status,
            taskId: row.taskId,
            createdAt: row.createdAt,
            score: row.score,
            voters: row.voters,
            myVote: row.myVote,
          });
        } catch {
          // Unreadable. Dropped, not shown as an error.
        }
      }

      // Open ideas first, then by score, then newest — which is the order a board is read in.
      opened.sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return b.createdAt.localeCompare(a.createdAt);
      });

      setIdeas(opened);
      setError("");
    } catch {
      setError("The board could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [memberToken, roomId, roomKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Opens a sealed idea body. Isolated so the loop above can skip a row that fails. */
  async function sealOpen(ciphertext: string, key: RoomKeyHandle): Promise<unknown> {
    const { openMessage } = await import("@/lib/rooms/crypto");
    const payload = await openMessage(ciphertext, key);
    return payload.body;
  }

  const addIdea = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || !roomKey) return false;
      try {
        // Sealed here, in the browser, because this is the only place the room key exists.
        const sealed = await sealMessage({ alias: "", body, kind: "idea" } as never, roomKey);
        const response = await fetch(`/api/rooms/ideas?roomId=${encodeURIComponent(roomId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-room-member": memberToken },
          body: JSON.stringify({ ciphertext: sealed.ciphertext }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "That idea could not be added.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("That idea could not be added.");
        return false;
      }
    },
    [memberToken, refresh, roomId, roomKey],
  );

  const vote = useCallback(
    async (ideaId: string, value: 1 | -1) => {
      try {
        // Voting the same way twice withdraws, which is what a button that already shows your
        // vote should do. Sending the opposite value would need two buttons and would make
        // "I agree" and "I no longer agree" different gestures.
        const current = ideas.find((idea) => idea.id === ideaId)?.myVote ?? 0;
        const response = await fetch(
          `/api/rooms/ideas/${ideaId}/vote?roomId=${encodeURIComponent(roomId)}`,
          {
            method: current === value ? "DELETE" : "POST",
            headers: { "Content-Type": "application/json", "x-room-member": memberToken },
            body: current === value ? undefined : JSON.stringify({ vote: value }),
          },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "That vote could not be recorded.");
          return;
        }
        await refresh();
      } catch {
        setError("That vote could not be recorded.");
      }
    },
    [ideas, memberToken, refresh, roomId],
  );

  const setStatus = useCallback(
    async (ideaId: string, status: "open" | "accepted" | "dropped") => {
      try {
        const response = await fetch(
          `/api/rooms/ideas/${ideaId}?roomId=${encodeURIComponent(roomId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-room-member": memberToken },
            body: JSON.stringify({ status }),
          },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "That idea could not be changed.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("That idea could not be changed.");
        return false;
      }
    },
    [memberToken, refresh, roomId],
  );

  return { ideas, loading, error, refresh, addIdea, vote, setStatus };
}