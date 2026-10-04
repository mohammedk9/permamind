"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { RoomModelTarget } from "@/lib/rooms/server-types";

/**
 * ## What a member agreed about their own model
 *
 * Three words and two numbers, and every one of them is a promise about somebody else's money.
 * The defaults are the safe ones: `silent`, and no ceiling set — which is a real choice rather
 * than a missing setting, so the two are never confused.
 *
 * The usage line is not decoration. A budget an owner cannot see being spent is not a budget,
 * it is a hope, so the count sits next to the control that changes it.
 */
export function ModelSharingControls({
  roomId,
  memberToken,
  model,
  onSaved,
  ar,
}: {
  roomId: string;
  memberToken: string;
  /** The caller's own model row, or null when they have registered none. */
  model: RoomModelTarget | null;
  onSaved: () => Promise<void> | void;
  ar: boolean;
}) {
  const [sharing, setSharing] = useState<"silent" | "on_request" | "always">(
    model?.sharing ?? "silent",
  );
  const [callLimit, setCallLimit] = useState(model?.callLimit === null || model?.callLimit === undefined ? "" : String(model.callLimit));
  const [dailyLimit, setDailyLimit] = useState(model?.dailyLimit === null || model?.dailyLimit === undefined ? "" : String(model.dailyLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!model) return null;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/panel?roomId=${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-room-member": memberToken },
        body: JSON.stringify({
          sharing,
          callLimit: callLimit === "" ? null : Number(callLimit),
          dailyLimit: dailyLimit === "" ? null : Number(dailyLimit),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (ar ? "تعذر الحفظ." : "That could not be saved."));
        return;
      }
      await onSaved();
    } catch {
      setError(ar ? "تعذر الحفظ." : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const exhausted =
    (model.callLimit !== null && model.totalCalls >= model.callLimit) ||
    (model.dailyLimit !== null && model.callsToday >= model.dailyLimit);

  const choice = (value: string) => (
    <option key={value} value={value}>
      {value === "silent"
        ? ar ? "لا يرد إطلاقا" : "Never answers"
        : value === "on_request"
          ? ar ? "عند طلب أحدهم" : "When asked by name"
          : ar ? "يحضر وحده" : "Joins unprompted"}
    </option>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium">
          {ar ? "متى يرد نموذجك" : "When may your model answer?"}
        </span>
        <span className={`text-xs tabular-nums ${exhausted ? "text-destructive" : "text-muted-foreground"}`}>
          {ar
            ? `استخدم ${model.totalCalls} مرة · ${model.callsToday} اليوم`
            : `Used ${model.totalCalls} time${model.totalCalls === 1 ? "" : "s"} · ${model.callsToday} today`}
          {exhausted ? (ar ? " · انتهت ميزانيتك" : " · out of budget") : ""}
        </span>
      </div>

      <select
        value={sharing}
        onChange={(event) => setSharing(event.target.value as typeof sharing)}
        disabled={busy}
        aria-label={ar ? "متى يرد نموذجك" : "When your model answers"}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        {choice("silent")}
        {choice("on_request")}
        {choice("always")}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">
            {ar ? "حد الغرفة" : "Room limit"}
          </span>
          <input
            type="number"
            min={1}
            max={10000}
            value={callLimit}
            onChange={(event) => setCallLimit(event.target.value)}
            placeholder={ar ? "بلا حد" : "no limit"}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">
            {ar ? "حد يومي" : "Daily limit"}
          </span>
          <input
            type="number"
            min={1}
            max={10000}
            value={dailyLimit}
            onChange={(event) => setDailyLimit(event.target.value)}
            placeholder={ar ? "بلا حد" : "no limit"}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
      </div>

      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save()}>
        {ar ? "احفظ" : "Save"}
      </Button>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {ar
          ? "عند «يحضر وحده» يرد من تلقاء نفسه حين يفيد النقاش — وداخل حدك. «عند طلب أحدهم» يعني أن يناديه أحد بالاسم."
          : "“Joins unprompted” means your model may speak when the discussion calls for it — still inside your limit. “When asked by name” means a member has to address it."}
      </p>
    </div>
  );
}