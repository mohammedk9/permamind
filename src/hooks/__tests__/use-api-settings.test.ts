import { describe, expect, it } from "vitest";

import { canSendWith, type ConnectionStatus } from "@/hooks/use-api-settings";

const connected: ConnectionStatus = "connected";
const connectedKey = { apiKey: "sk-test", modelName: "", connectionStatus: connected };

describe("canSendWith", () => {
  it("allows the free allowance with nothing configured", () => {
    expect(
      canSendWith({ provider: "openrouter", mode: "free", ...connectedKey }),
    ).toBe(true);
  });

  it("requires a validated key for BYOK", () => {
    // A stored key alone is not enough: it must have been checked against the
    // provider, otherwise the first send is what discovers it is wrong.
    expect(
      canSendWith({
        provider: "openai",
        mode: "byok",
        apiKey: "sk-test",
        modelName: "",
        connectionStatus: "unknown",
      }),
    ).toBe(false);

    // Neither is an empty key, whatever the status says.
    expect(
      canSendWith({
        provider: "openai",
        mode: "byok",
        apiKey: "   ",
        modelName: "",
        connectionStatus: "connected",
      }),
    ).toBe(false);

    expect(
      canSendWith({
        provider: "openai",
        mode: "byok",
        apiKey: "sk-test",
        modelName: "",
        connectionStatus: "connected",
      }),
    ).toBe(true);
  });

  it("refuses a local model with no name, instead of failing at the server", () => {
    // The server rejects a keyless request without `x-ai-model`; letting this
    // through only produced a 500 the user could not act on.
    expect(
      canSendWith({
        provider: "ollama",
        mode: "byok",
        apiKey: "",
        modelName: "   ",
        connectionStatus: "connected",
      }),
    ).toBe(false);
  });

  it("allows a local model once it is named and the daemon answers", () => {
    expect(
      canSendWith({
        provider: "ollama",
        mode: "byok",
        apiKey: "",
        modelName: "qwen2.5:3b",
        connectionStatus: "connected",
      }),
    ).toBe(true);
  });

  it("refuses a local model that has not been checked yet", () => {
    expect(
      canSendWith({
        provider: "ollama",
        mode: "byok",
        apiKey: "",
        modelName: "qwen2.5:3b",
        connectionStatus: "unknown",
      }),
    ).toBe(false);
  });
});