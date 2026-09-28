import { finalizeAiQuota, releaseAiQuota } from "@/lib/ai/usage-quota";

/**
 * Completes a quota reservation only when the upstream SSE response reaches
 * its terminal [DONE] event. A client abort, provider error event, truncated
 * response, or reader failure releases the reservation instead.
 */
export function createQuotaStream(
  body: ReadableStream<Uint8Array> | null,
  reservationId: string | undefined,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  let settled = false;

  const release = async () => {
    if (settled) return;
    settled = true;
    await releaseAiQuota(reservationId);
  };

  const finalize = async () => {
    if (settled) return;
    settled = true;
    await finalizeAiQuota(reservationId);
  };

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      if (!body) {
        await release();
        controller.error(new Error("No response stream received"));
        return;
      }

      reader = body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let sawDone = false;
      let sawProviderError = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) {
            await release();
            return;
          }

          controller.enqueue(value);
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "data: [DONE]") sawDone = true;
            if (trimmed.startsWith("data: ")) {
              try {
                const payload = JSON.parse(trimmed.slice(6)) as { error?: unknown };
                if (payload.error) sawProviderError = true;
              } catch {
                // The client parser handles malformed/incomplete SSE payloads.
              }
            }
          }
        }

        if (cancelled || sawProviderError || !sawDone) {
          await release();
          if (!cancelled && !sawProviderError) {
            const errorEvent = new TextEncoder().encode(
              'data: {"error":{"message":"Stream interrupted"}}\n\n',
            );
            controller.enqueue(errorEvent);
          }
          if (!cancelled) controller.close();
          return;
        }

        await finalize();
        if (!cancelled) controller.close();
      } catch (error) {
        await release();
        if (!cancelled) controller.error(error);
      } finally {
        reader = null;
      }
    },
    cancel: async (reason) => {
      cancelled = true;
      await reader?.cancel(reason);
      await release();
    },
  });
}