"use client";

// Imported rather than relying on the automatic JSX runtime, which is the convention for
// every component in this project that has a test: the Next.js build handles it either way,
// but the vitest transform does not, and a component that only renders under one of the two
// toolchains is a component nobody can test.
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { AI_MODELS } from "@/lib/ai/models";

/**
 * A panel member's own model.
 *
 * ## Why this exists and what it must never become
 *
 * A panel room is a room where each registered member brings a model and spends their own key.
 * This component is where that happens. The three rules it implements are all server-side —
 * this is the surface, not the authority:
 *
 *   1. The model is the member's own. There is no control here that names somebody else's,
 *      and the endpoint has no parameter that would accept one.
 *   2. The speciality comes from the host's list. The control renders exactly the roles the
 *      host offered, so a free-text answer is not even constructible.
 *   3. The room's cap is the host's. When it is reached the server refuses and this renders
 *      the refusal, rather than hiding the control and leaving a member guessing.
 *
 * ## Why "no model" is not an error
 *
 * `panel-rooms-proposal.md` section 6.1: a member who does not want to spend their key on a
 * debate is not failing to participate. So the empty state is a normal state, written as
 * one, and the button that fills it is right there.
 */
export function PanelModelControls({
  aiSpecialties,
  aiMaxModels,
  callerModel,
  registerModel,
  withdrawModel,
  busy,
  error,
  ar,
}: {
  /** The roles the host offered. Empty only if the host set none, which a panel forbids. */
  aiSpecialties: string[];
  /** The host's ceiling, or null when they set none. */
  aiMaxModels: number | null;
  /** The caller's own registration, or null when they have not registered. */
  callerModel: { modelId: string; modelLabel: string; specialty: string } | null;
  registerModel: (input: { modelId: string; modelLabel: string; specialty: string }) => Promise<unknown>;
  withdrawModel: () => Promise<unknown>;
  busy: boolean;
  error: string;
  ar: boolean;
}) {
  const [modelId, setModelId] = useState(callerModel?.modelId ?? "");
  const [specialty, setSpecialty] = useState(callerModel?.specialty ?? "");

  const chosen = AI_MODELS.find((model) => model.id === (modelId || callerModel?.modelId));

  // The speciality defaults to the host's first offer rather than to nothing, because a
  // panel is a room where each model has a job and leaving the choice blank is never what
  // the host meant.
  const effectiveSpecialty = specialty || aiSpecialties[0] || "";
  const ready = Boolean(chosen) && Boolean(effectiveSpecialty) && !busy;

  const submit = async () => {
    if (!chosen || !effectiveSpecialty) return;
    await registerModel({
      modelId: chosen.id,
      modelLabel: chosen.label,
      specialty: effectiveSpecialty,
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {ar ? "نموذجك في هذه الغرفة" : "Your model in this room"}
        </h3>
        {aiMaxModels !== null ? (
          <span className="text-xs text-muted-foreground">
            {ar
              ? `الحدّ ${aiMaxModels} نماذج`
              : `Room allows ${aiMaxModels} model${aiMaxModels === 1 ? "" : "s"}`}
          </span>
        ) : null}
      </div>

      {callerModel ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted px-3 py-2">
          <div className="text-sm">
            <span className="font-medium">{callerModel.modelLabel}</span>
            <span className="text-muted-foreground">
              {ar ? " · " : " · "}
              {callerModel.specialty}
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void withdrawModel()}>
            {ar ? "اسحب نموذجك" : "Withdraw"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {ar
            ? "لم تسجّل نموذجاً. يمكنك المشاركة دون إنفاق مفتاحك."
            : "You have not brought a model. You can take part without spending your key."}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">
            {ar ? "النموذج" : "Model"}
          </span>
          <select
            value={modelId || callerModel?.modelId || ""}
            onChange={(event) => setModelId(event.target.value)}
            disabled={busy}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{ar ? "اختر نموذجاً" : "Choose a model"}</option>
            {AI_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">
            {ar ? "الدور" : "Role"}
          </span>
          <select
            value={effectiveSpecialty}
            onChange={(event) => setSpecialty(event.target.value)}
            disabled={busy || aiSpecialties.length === 0}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {aiSpecialties.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button type="button" size="sm" disabled={!ready} onClick={() => void submit()}>
        {callerModel
          ? ar ? "بدّل نموذجك" : "Change your model"
          : ar ? "سجّل نموذجك" : "Bring your model"}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Stated, because a member who has just registered a model will otherwise assume the
          room is spending the host's money on their behalf. It is not, and that is the entire
          point of a panel. */}
      <p className="text-xs text-muted-foreground">
        {ar
          ? "ستسأل الغرفة بنموذجك وبمفتاحك فقط. لا تُنفق غرفة اللوحات مفتاح أحد."
          : "You will ask this room with your own model and your own key. A panel room never spends anyone else's."}
      </p>
    </div>
  );
}