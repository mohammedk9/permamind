import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/usage-quota", () => ({
  finalizeAiQuota: vi.fn().mockResolvedValue(undefined),
  releaseAiQuota: vi.fn().mockResolvedValue(undefined),
}));

import { finalizeAiQuota, releaseAiQuota } from "@/lib/ai/usage-quota";
import { createQuotaStream } from "./quota-stream";

const encoder = new TextEncoder();

function upstream(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return new TextDecoder().decode(concat(chunks));
    chunks.push(next.value);
  }
}

function concat(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe("quota stream lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finalizes a reservation only after [DONE]", async () => {
    const result = await readAll(createQuotaStream(
      upstream('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', "data: [DONE]\n\n"),
      "reservation-1",
    ));

    expect(result).toContain("hello");
    expect(finalizeAiQuota).toHaveBeenCalledWith("reservation-1");
    expect(releaseAiQuota).not.toHaveBeenCalled();
  });

  it("releases a reservation when the upstream stream ends without [DONE]", async () => {
    const result = await readAll(createQuotaStream(
      upstream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      "reservation-2",
    ));

    expect(result).toContain("partial");
    expect(result).toContain("Stream interrupted");
    expect(releaseAiQuota).toHaveBeenCalledWith("reservation-2");
    expect(finalizeAiQuota).not.toHaveBeenCalled();
  });

  it("releases a reservation when the client cancels the stream", async () => {
    let unblock: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise<void>((resolve) => { unblock = resolve; });
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n"));
      },
    });
    const reader = createQuotaStream(body, "reservation-3").getReader();
    const pending = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await reader.cancel("client aborted");
    unblock?.();
    await pending.catch(() => undefined);

    expect(releaseAiQuota).toHaveBeenCalledWith("reservation-3");
    expect(finalizeAiQuota).not.toHaveBeenCalled();
  });
});