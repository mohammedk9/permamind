"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RoomSpendSummary } from "@/lib/rooms/server-types";

/**
 * The host's controls: the read-only switch, and what the room has cost.
 *
 * ## Why spend is counts and not money
 *
 * The server knows how many calls were made and which model answered. It does not know what
 * the host's key costs per token — that is their provider's contract, not something we can read
 * off a request. So this panel shows calls, and says in as many words that they are not a
 * price. A currency figure here would be a guess wearing a currency symbol, and the host would
 * act on it.
 *
 * ## Why this is host-only rather than host-visible
 *
 * It renders for the host and nothing else. The spend endpoint refuses anyone else with the
 * same 404 a stranger gets, so hiding this is presentation and the refusal is the control.
 */
export function RoomHostControls({
  roomId,
  memberToken,
  readOnly,
  onReadOnlyChange,
  ar,
}: {
  roomId: string;
  memberToken: string;
  /** Whether guests are currently locked out of writing. */
  readOnly: boolean;
  /** Lets the room lift its own switch without a reload. The host is exempt from the rule. */
  onReadOnlyChange: (readOnly: boolean) => void;
  ar: boolean;
}) {
  const [spend, setSpend] = useState<RoomSpendSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/settings?roomId=${encodeURIComponent(roomId)}`, {
        headers: { "x-room-member": memberToken },
      });
      // A refusal here is expected for anyone who is not the host; the panel simply stays
      // empty rather than showing an error the host cannot act on.
      if (!response.ok) return;
      const data = (await response.json()) as { spend: RoomSpendSummary };
      setSpend(data.spend);
    } catch {
      // The room keeps working without the panel.
    }
  }, [roomId, memberToken]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggleReadOnly = async () => {
    const next = !readOnly;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/settings?roomId=${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-room-member": memberToken },
        body: JSON.stringify({ readOnly: next }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (ar ? "تعذر التغيير." : "That change could not be made."));
        return;
      }
      onReadOnlyChange(next);
      // Re-read, so the spend shown is not the figure from before the change.
      void load();
    } catch {
      setError(ar ? "تعذر التغيير." : "That change could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant={readOnly ? "secondary" : "outline"}
          size="sm"
          disabled={busy}
          onClick={() => void toggleReadOnly()}
        >
          {readOnly
            ? ar ? "الغرفة للقراءة فقط" : "Room is read-only"
            : ar ? "اجعل الغرفة للقراءة فقط" : "Make the room read-only"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((value) => !value)}
          className="text-muted-foreground"
        >
          {open ? (ar ? "إخفاء الإنفاق" : "Hide spend") : ar ? "إنفاق الغرفة" : "Room spend"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3">
          {!spend || spend.totalCalls === 0 ? (
            <p className="text-xs text-muted-foreground">
              {ar ? "لم يسأل النموذج بعد." : "The model has not been asked anything yet."}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {ar
                  ? `${spend.totalCalls} استدعاء · ${spend.callsLastDay} اليوم`
                  : `${spend.totalCalls} call${spend.totalCalls === 1 ? "" : "s"} · ${spend.callsLastDay} today`}
              </p>

              <ul className="space-y-1">
                {spend.members.map((member) => (
                  <li key={member.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{member.label}</code>
                      <span className="text-muted-foreground">
                        {member.role === "host"
                          ? ar ? "المضيف" : "Host"
                          : member.role === "trusted"
                            ? ar ? "موثوق" : "Trusted"
                            : ar ? "ضيف" : "Guest"}
                      </span>
                    </span>
                    <span>{member.calls}</span>
                  </li>
                ))}
              </ul>

              {spend.models.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  {ar ? "النماذج:" : "Models:"}{" "}
                  {spend.models.map((entry) => `${entry.model} ×${entry.calls}`).join(" · ")}
                </p>
              ) : null}
            </>
          )}

          {/* Stated, not implied. A host seeing "12" may reasonably assume it is a price, and
              this is the one place the panel can correct that before they act on it. */}
          <p className="text-xs text-muted-foreground">
            {ar
              ? "هذه استدعاءات لا مبالغ. التكلفة تعتمد على مزودك."
              : "These are calls, not money. What they cost depends on your provider."}
          </p>
        </div>
      ) : null}
    </div>
  );
}