import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Idea } from "@/hooks/use-room-ideas";

/**
 * The room's board.
 *
 * ## Who may do what
 *
 * Anyone may propose and anyone may vote, a guest included — neither spends a key. Only the
 * host may accept, drop, or convert, and that split is the whole of section 9's boundary: what
 * leaves the room and becomes the host's permanent record is the host's decision, never the
 * room's majority.
 *
 * ## The score is not the decision
 *
 * The board sorts by score because that is what helps a group find consensus, but a high
 * score is not acceptance and the UI never says it is. The host's Accept button is the only
 * thing that moves anything out of this room.
 */
export function IdeasBoard({
  ideas,
  loading,
  error,
  role,
  addIdea,
  vote,
  setStatus,
  ar,
}: {
  ideas: Idea[];
  loading: boolean;
  error: string;
  role: "host" | "trusted" | "guest";
  addIdea: (text: string) => Promise<boolean>;
  vote: (ideaId: string, value: 1 | -1) => Promise<void>;
  setStatus: (ideaId: string, status: "open" | "accepted" | "dropped") => Promise<boolean>;
  ar: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await addIdea(text);
    setBusy(false);
    // Cleared only on success. Losing what someone typed because the network blinked is the
    // kind of small betrayal that makes people stop trying a feature twice.
    if (ok) setDraft("");
  };

  return (
    <section className="space-y-3 border-t border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{ar ? "الأفكار" : "Ideas"}</h2>
        <span className="text-xs text-muted-foreground">{ideas.length}</span>
      </div>

      {/* Any member, a guest included. */}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={ar ? "اكتب فكرة…" : "Add an idea…"}
          disabled={busy}
          className="flex-1 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring"
        />
        <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void submit()}>
          {ar ? "أضف" : "Add"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : ideas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {ar ? "لا أفكار بعد." : "No ideas yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className={`rounded-md border px-3 py-2 ${
                idea.status === "dropped" ? "border-border opacity-60" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm ${idea.status === "accepted" ? "font-medium" : ""}`}>
                  {idea.text}
                  {idea.status === "accepted" ? (
                    <span className="ml-2 text-xs text-primary">
                      {ar ? "مقبولة" : "accepted"}
                    </span>
                  ) : null}
                  {idea.status === "dropped" ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {ar ? "مستبعدة" : "dropped"}
                    </span>
                  ) : null}
                </p>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={ar ? "تصويت مع" : "Vote up"}
                    aria-pressed={idea.myVote === 1}
                    onClick={() => void vote(idea.id, 1)}
                    className={`rounded px-1.5 text-xs ${
                      idea.myVote === 1 ? "bg-primary/15 text-primary" : "text-muted-foreground"
                    }`}
                  >
                    ▲
                  </button>
                  <span className="min-w-5 text-center text-xs tabular-nums">
                    {idea.score}
                  </span>
                  <button
                    type="button"
                    aria-label={ar ? "تصويت ضد" : "Vote down"}
                    aria-pressed={idea.myVote === -1}
                    onClick={() => void vote(idea.id, -1)}
                    className={`rounded px-1.5 text-xs ${
                      idea.myVote === -1 ? "bg-primary/15 text-primary" : "text-muted-foreground"
                    }`}
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* Host only. A member who cannot decide should not be shown a control that
                  fails — they should see that deciding is somebody else's job here. */}
              {role === "host" ? (
                <div className="mt-2 flex gap-2">
                  {idea.status !== "accepted" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void setStatus(idea.id, "accepted")}
                    >
                      {ar ? "اقبلها" : "Accept"}
                    </Button>
                  ) : null}
                  {idea.status !== "dropped" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void setStatus(idea.id, "dropped")}
                    >
                      {ar ? "استبعدها" : "Drop"}
                    </Button>
                  ) : null}
                  {idea.taskId ? (
                    <span className="self-center text-xs text-muted-foreground">
                      {ar ? "أصبحت مهمة" : "Became a task"}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* The boundary, stated. Without it a member may reasonably assume the top-scoring idea
          is already in the host's memory, and it is not. */}
      <p className="text-xs text-muted-foreground">
        {ar
          ? "التصويت يساعد المجموعة. القرار للمضيف وحده، ولا يخرج شيء من الغرفة إلا بقراره."
          : "Voting helps the group. The host alone decides, and nothing leaves this room without their decision."}
      </p>
    </section>
  );
}