import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryControls } from "@/components/memory/memory-controls";
import type { MemoryRecord } from "@/types/memory";

const NOW = "2026-01-02T10:00:00.000Z";

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: "decision",
    conversationId: "c1",
    conversationTitle: "Launch plan",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "extracted",
    updatedAt: NOW,
    ...overrides,
  };
}

function renderControls(records: MemoryRecord[]) {
  return render(
    <MemoryControls
      records={records}
      onPin={() => {}}
      onCorrect={() => {}}
      onForget={() => {}}
      onRestore={() => {}}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("MemoryControls provenance", () => {
  it("labels a record the app extracted from the conversation", () => {
    renderControls([record({ id: "d1", text: "Launch on Tuesday after the beta" })]);

    expect(screen.getByText("locally extracted")).toBeTruthy();
  });

  it("does not label a record the user wrote", () => {
    renderControls([record({ id: "d1", text: "Launch on Tuesday", source: "user" })]);

    expect(screen.queryByText("locally extracted")).toBeNull();
  });

  it("labels a local model's extraction in Arabic too", async () => {
    window.localStorage.setItem("permamind-locale", "ar");
    renderControls([record({ id: "d1", text: "الإطلاق الثلاثاء" })]);

    expect(await screen.findByText("مستخرج محليًا")).toBeTruthy();
  });

  it("still offers correct and forget on an extracted record", () => {
    const onCorrect = vi.fn();
    render(
      <MemoryControls
        records={[record({ id: "d1", text: "Launch on Tuesday" })]}
        onPin={() => {}}
        onCorrect={onCorrect}
        onForget={() => {}}
        onRestore={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Correct" }));

    expect(screen.getByLabelText("Correct decision")).toBeTruthy();
  });
});