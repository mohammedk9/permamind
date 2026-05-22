"use client";

import { BarChart3, Brain, MessageSquare, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  formatCostUsd,
  formatTokens,
} from "@/lib/analytics/aggregate";
import type { AnalyticsSummary } from "@/types/analytics";
import { getModelById } from "@/lib/ai/models";
import { SUMMARY_MODEL } from "@/lib/ai/summary-model";

interface UsagePanelProps {
  summary: AnalyticsSummary;
  onClear: () => void;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function modelLabel(modelId: string): string {
  if (modelId === SUMMARY_MODEL) return "Gemini Flash (summaries)";
  return getModelById(modelId)?.label ?? modelId.split("/").pop() ?? modelId;
}

export function UsagePanel({ summary, onClear }: UsagePanelProps) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
          />
        }
      >
        <BarChart3 className="size-4" />
        Usage & memory
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Usage & memory observability</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Overview
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="Est. total cost"
                  value={formatCostUsd(summary.totalCostUsd)}
                  sub={`${formatTokens(summary.totalTokens)} tokens`}
                />
                <StatCard
                  label="Chat requests"
                  value={String(summary.chatRequests)}
                  sub={`${summary.summaryRequests} summaries`}
                />
                <StatCard
                  label="Today"
                  value={formatCostUsd(summary.today.estimatedCostUsd)}
                  sub={`${summary.today.requests} requests`}
                />
                <StatCard
                  label="This month"
                  value={formatCostUsd(summary.thisMonth.estimatedCostUsd)}
                  sub={`${formatTokens(summary.thisMonth.totalTokens)} tokens`}
                />
              </div>
            </section>

            <Separator />

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <BarChart3 className="size-3.5" />
                Per-model usage
              </h3>
              {summary.byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground">No API usage yet.</p>
              ) : (
                <div className="space-y-2">
                  {summary.byModel.map((m) => (
                    <div
                      key={m.model}
                      className="rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{modelLabel(m.model)}</span>
                        <span className="text-muted-foreground">
                          {formatCostUsd(m.estimatedCostUsd)}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {m.requests} req · {formatTokens(m.totalTokens)} tok
                        <span className="mx-1">·</span>
                        in {formatTokens(m.promptTokens)} / out{" "}
                        {formatTokens(m.completionTokens)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="size-3.5" />
                Conversation stats
              </h3>
              {summary.topConversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No conversation-level data yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {summary.topConversations.map((c) => (
                    <div
                      key={c.conversationId}
                      className="rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <p className="line-clamp-1 font-medium">{c.conversationTitle}</p>
                      <p className="mt-1 text-muted-foreground">
                        {c.chatRequests} chats · {c.summaryRequests} summaries ·{" "}
                        {c.memoryRetrievals} retrievals ·{" "}
                        {formatCostUsd(c.estimatedCostUsd)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Brain className="size-3.5" />
                Memory retrieval debug
              </h3>
              <p className="mb-2 text-xs text-muted-foreground">
                {summary.memoryRetrievalCount} total retrievals · shows injected
                memories per query
              </p>
              {summary.recentMemoryRetrievals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No memory retrievals logged yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {summary.recentMemoryRetrievals.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-foreground">
                        &ldquo;{r.query.slice(0, 80)}
                        {r.query.length > 80 ? "…" : ""}&rdquo;
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {r.memoriesFound} injected · {r.conversationTitle} ·{" "}
                        {new Date(r.timestamp).toLocaleString()}
                      </p>
                      {r.memoryRecords.length > 0 && (
                        <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                          {r.memoryRecords.map((m) => (
                            <li
                              key={`${r.id}-${m.conversationId}`}
                              className="text-muted-foreground"
                            >
                              <span className="font-medium text-foreground">
                                {m.conversationTitle}
                              </span>{" "}
                              ({m.source}, score {m.score.toFixed(1)})
                              <span className="line-clamp-1">{m.excerpt}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" />
                Recent API events
              </h3>
              <div className="space-y-1.5">
                {summary.recentEvents.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-[10px]"
                  >
                    <span className="capitalize">{e.type.replace("_", " ")}</span>
                    <span className="text-muted-foreground">
                      {e.type === "memory_retrieval"
                        ? `${(e as { memoriesFound: number }).memoriesFound} memories`
                        : e.type === "chat" || e.type === "summary"
                          ? `${formatTokens((e as { totalTokens: number }).totalTokens)} · ${formatCostUsd((e as { estimatedCostUsd: number }).estimatedCostUsd)}`
                          : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>

        <div className="border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-destructive"
            onClick={onClear}
          >
            <Trash2 className="size-3.5" />
            Clear analytics data
          </Button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Stored locally · costs are estimates
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
