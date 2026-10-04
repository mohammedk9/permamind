"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RoomMemberView } from "@/types/room";

/**
 * The host's view of who is in the room, and the only control over AI spending.
 *
 * There is no search box and no display names here, and that is the honest shape of the
 * problem: names are encrypted inside message payloads and the server cannot read them, so
 * the host is given a short label per member. The room solves this the other way round — a
 * member reads their own label aloud or types it into chat, and the host matches the two.
 *
 * The panel renders nothing at all for anyone who is not the host. It is not merely hidden:
 * a guest should not learn who else is in the room.
 */
export function RoomMembersPanel({
  roomId,
  memberToken,
  ar,
  onChanged,
}: {
  roomId: string;
  memberToken: string;
  ar: boolean;
  /** Called after any successful change, so the caller can refresh the AI availability. */
  onChanged?: () => void;
}) {
  const [members, setMembers] = useState<RoomMemberView[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/members?roomId=${encodeURIComponent(roomId)}`, {
        headers: { "x-room-member": memberToken },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { members: RoomMemberView[] };
      setMembers(data.members);
    } catch {
      // A panel that cannot load is not worth interrupting the host over; the room itself
      // keeps working and the toggle simply shows no one.
    }
  }, [roomId, memberToken]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * Every mutation goes through here so there is one error path and one refresh path.
   * `method` is passed per call site rather than read from JSX, so a button cannot send a
   * DELETE when it meant a PATCH.
   */
  const mutate = async (targetLabel: string, method: "PATCH" | "DELETE", role?: "trusted" | "guest") => {
    setBusy(targetLabel);
    setError("");
    try {
      const response = await fetch(`/api/rooms/members?roomId=${encodeURIComponent(roomId)}`, {
        method,
        headers: { "x-room-member": memberToken, "Content-Type": "application/json" },
        body: JSON.stringify(role ? { targetLabel, role } : { targetLabel }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (ar ? "تعذر تنفيذ التغيير." : "That change could not be made."));
        return;
      }
      await load();
      onChanged?.();
    } catch {
      setError(ar ? "تعذر تنفيذ التغيير." : "That change could not be made.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground"
      >
        {open
          ? ar ? "إخفاء الأعضاء" : "Hide members"
          : ar ? "إدارة الأعضاء" : "Manage members"}
      </Button>

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {ar
              ? "كل عضو يرى الرمز الخاص به. اطلب منه قراءته ثم امنح الثقة من هنا."
              : "Every member sees their own label. Ask them to read it out, then grant trust here."}
          </p>

          <ul className="space-y-2">
            {members.map((member) => (
              <li
                key={member.label}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{member.label}</code>
                  <span className="text-muted-foreground">
                    {member.role === "host"
                      ? ar ? "المضيف" : "Host"
                      : member.role === "trusted"
                        ? ar ? "موثوق" : "Trusted"
                        : ar ? "ضيف" : "Guest"}
                  </span>
                </span>

                {member.role !== "host" ? (
                  <span className="flex items-center gap-1">
                    {member.role === "guest" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy === member.label}
                        onClick={() => void mutate(member.label, "PATCH", "trusted")}
                      >
                        {ar ? "امنح الثقة" : "Trust"}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy === member.label}
                        onClick={() => void mutate(member.label, "PATCH", "guest")}
                      >
                        {ar ? "ألغ الثقة" : "Untrust"}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy === member.label}
                      onClick={() => void mutate(member.label, "DELETE")}
                      className="text-destructive"
                    >
                      {ar ? "إزالة" : "Remove"}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}