import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsShell } from "@/components/settings/settings-shell";
import type { ChatPlan } from "@/lib/chat/plans";

function renderShell(overrides: Partial<React.ComponentProps<typeof SettingsShell>> = {}) {
  const props = {
    apiKey: "",
    provider: "openrouter" as const,
    onProviderChange: () => {},
    baseUrl: "",
    onBaseUrlChange: () => {},
    modelName: "",
    onModelNameChange: () => {},
    connectionStatus: "connected" as const,
    plan: "free" as ChatPlan,
    onPlanChange: () => {},
    semantic: { enabled: false, status: "off" as const, progress: 0 },
    onToggleSemantic: () => {},
    onApiKeyChange: () => {},
    onValidate: async () => true,
    onClearKey: () => {},
    onClearAnalytics: () => {},
    conversations: [],
    ...overrides,
  };
  return render(<SettingsShell {...props} />);
}

/** A local plan with a model name, for the checks that need an enabled control. */
function renderCardWithModel() {
  return renderShell({ plan: "local", provider: "ollama", modelName: "qwen2.5:3b" });
}

beforeEach(() => {
  window.localStorage.clear();
  // The AI section also renders the room-key panel, which reads its tokens on
  // mount. Nothing here is about those tokens.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ tokens: [] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsShell plan choice", () => {
  it("offers exactly the three plans, with the chosen one marked", () => {
    renderShell({ plan: "byok" });

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("reports the plan the user picks", () => {
    const onPlanChange = vi.fn();
    renderShell({ onPlanChange });

    fireEvent.click(screen.getByRole("radio", { name: /A local model on this device/ }));

    expect(onPlanChange).toHaveBeenCalledWith("local");
  });

  it("does not ask for a key on the free allowance", () => {
    renderShell({ plan: "free" });

    expect(screen.queryByLabelText("AI provider API key")).toBeNull();
    // The card's own line, not the radio label that shares its first words.
    expect(screen.getByText(/You get 10 free messages a day/)).toBeTruthy();
  });

  it("asks for a key, a provider, and a model when BYOK is chosen", () => {
    renderShell({ plan: "byok" });

    expect(screen.getByLabelText("AI provider API key")).toBeTruthy();
    expect(screen.getByLabelText("AI provider")).toBeTruthy();
    expect(screen.getByLabelText("Model name")).toBeTruthy();
  });

  it("asks only for a model when the local plan is chosen", () => {
    renderShell({ plan: "local", provider: "ollama", modelName: "" });

    // No key field: a local model has no key, and showing one invites the user
    // to paste a secret that will never be used.
    expect(screen.queryByLabelText("AI provider API key")).toBeNull();
    expect(screen.getByLabelText("Model name")).toBeTruthy();
    expect(screen.getByText(/runs on this device through Ollama/)).toBeTruthy();
  });

  it("explains why the local plan cannot send until a model is named", () => {
    renderShell({ plan: "local", provider: "ollama", modelName: "" });

    expect(screen.getByText(/Enter a model that Ollama has pulled first/)).toBeTruthy();
    // The check is disabled rather than pretending it can succeed.
    const check = screen.getByRole("button", { name: /Check connection/ }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
  });

  it("offers the connection check once a model is named", () => {
    renderCardWithModel();

    const check = screen.getByRole("button", { name: /Check connection/ }) as HTMLButtonElement;
    expect(check.disabled).toBe(false);
  });

  it("names the three plans in Arabic too", async () => {
    window.localStorage.setItem("permamind-locale", "ar");
    renderShell();

    expect(await screen.findByRole("radio", { name: /10 رسائل مجانية يوميًا/ })).toBeTruthy();
  });
});