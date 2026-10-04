"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RoomModelTarget } from "@/lib/rooms/server-types";

/**
 * ## Addressing a model in a panel room
 *
 * The list of everyone else's models in the room, with the owner shown, so a member can ask
 * **which** one they want rather than whatever answers by chance. That is the whole of "no
 * random replies": a model speaks when a person names it, or when its owner set it to `always`
 * — never because it decided the room was interesting.
 *
 * ## Who pays
 *
 * The owner of the model that answers, counted against the owner's own budget. Every row says
 * so, because a member asking someone else's model is spending their money and should know it
 * before pressing the button rather than after.
 */
export function ModelAddressPicker({
  models,
  selected,
  onSelect,
  busy,
  ar,
}: {
  models: RoomModelTarget[];
  selected: string | null;
  onSelect: (slot: string | null) => void;
  busy: boolean;
  ar: boolean;
}) {
  // A model whose owner withdrew their consent stays in the list but cannot be chosen, so a
  // member learns the model exists rather than being shown a room with a smaller cast.
  const addressable = models.filter((model) => model.sharing !== "silent");

  const exhausted = (model: RoomModelTarget) =>
    (model.callLimit !== null && model.totalCalls >= model.callLimit) ||
    (model.dailyLimit !== null && model.callsToday >= model.dailyLimit);

  const byName = [...addressable].sort((a, b) =>
    a.modelLabel.localeCompare(b.modelLabel),
  );
  const rest = [...addressable].sort((a, b) => Number(a.isMine) - Number(b.isMine));

  const option = (model: RoomModelTarget) => {
    const spent = exhausted(model);
    return (
      <option
        key={model.slot}
        value={model.slot}
        disabled={spent}
        className={spent ? "text-muted-foreground line-through" : ""}
      >
        {model.modelLabel} — {model.specialty}
        {model.isMine ? (ar ? " (نموذجك)" : " (yours)") : ""}
        {spent ? (ar ? " — استنفدت ميزانيته" : " — out of budget") : ""}
      </option>
    );
  };

  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor="room-model-target" className="text-xs text-muted-foreground">
        {ar ? "من يرد" : "Who answers?"}
      </label>
      <select
        id="room-model-target"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        disabled={busy}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        <option value="">{ar ? "اسأل…" : "Ask…"}</option>
        {byName.length > 0 ? (
          <optgroup label={ar ? "النماذج" : "Models"}>
            {byName.map(option)}
          </optgroup>
        ) : null}
        {rest.length > byName.length ? null : null}
        {rest.map(option)}
      </select>

      {selected ? (
        <p className="text-xs text-muted-foreground">
          {(() => {
            const model = models.find((m) => m.slot === selected);
            if (!model) return null;
            return model.isMine
              ? ar
                ? "يستخدم نموذجك وتحسب على ميزانيتك."
                : "Uses your model, counted against your own budget."
              : ar
                ? "يحمل صاحبه التكلفة وقد وافق على ذلك بحده."
                : "Its owner pays for this, and has agreed a limit.";
          })()}
        </p>
      ) : null}
    </div>
  );
}