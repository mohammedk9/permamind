"use client";

import { useCallback, useEffect, useState } from "react";

import type { RoomModelTarget } from "@/lib/rooms/server-types";

/**
 * The room's cast of models, and the caller's choice among them.
 *
 * ## Why this is a separate hook
 *
 * The models are a property of the *room*, not of the transcript: they change when somebody
 * registers one, and they are read far less often than messages. Keeping them out of the
 * transcript hook means a member asking a question does not re-fetch everybody's registrations
 * to find out whether the room has any.
 *
 * ## Why a member picks a model rather than the room choosing one
 *
 * A panel where every model answers everything is noise, and the cost lands on whoever owns
 * each model. Naming the model is the whole of the control: a member presses the one whose view
 * they want, and no other model is asked to speak.
 */
export function useRoomModels(roomId: string, memberToken: string) {
  const [models, setModels] = useState<RoomModelTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!memberToken) return;
    try {
      const response = await fetch(`/api/rooms/models?roomId=${encodeURIComponent(roomId)}`, {
        headers: { "x-room-member": memberToken },
        cache: "no-store",
      });
      if (!response.ok) {
        setError("The room's models could not be loaded.");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as { models: RoomModelTarget[] };
      setModels(data.models ?? []);
      setError("");
    } catch {
      setError("The room's models could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [memberToken, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Drops a selection that is no longer valid.
   *
   * An owner may withdraw a model, or exhaust its budget, while this tab is open. Keeping a
   * stale selection would send a `modelSlot` the server will refuse, which reads to the member
   * as a broken button rather than as a choice that stopped being available.
   */
  useEffect(() => {
    setTarget((current) => {
      if (!current) return current;
      const model = models.find((m) => m.slot === current);
      return model && model.sharing !== "silent" ? current : null;
    });
  }, [models]);

  return { models, loading, error, target, setTarget, refresh };
}