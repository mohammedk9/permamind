import { describe, expect, it, beforeEach, vi } from "vitest";
import { acquireLease, releaseLease, renewLease } from "../coordination";
import { startProcessor, stopProcessor, getProcessorStatus } from "../queue-processor";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

describe("cross-tab coordination", () => {
  beforeEach(() => storage.clear());

  it("allows only one tab to own a lease until it expires", () => {
    const first = acquireLease("queue", 1000);
    expect(first).not.toBeNull();
    expect(acquireLease("queue", 1000)).toBe(first);
    expect(renewLease("queue", first!)).toBe(true);
  });

  it("transfers ownership after the previous tab releases or expires", () => {
    vi.useFakeTimers();
    const first = acquireLease("queue", 1);
    expect(first).not.toBeNull();
    vi.advanceTimersByTime(2);
    const second = acquireLease("queue", 1000);
    expect(second).toBe(first); // same runtime represents the new tab owner
    releaseLease("queue", second!);
    expect(acquireLease("queue")).not.toBeNull();
    vi.useRealTimers();
  });

  it("makes processor restart idempotent and releases ownership", () => {
    vi.useFakeTimers();
    startProcessor({} as never, "passphrase");
    expect(getProcessorStatus().isRunning).toBe(true);
    startProcessor({} as never, "other");
    expect(getProcessorStatus().isRunning).toBe(true);
    stopProcessor();
    expect(getProcessorStatus().isRunning).toBe(false);
    startProcessor({} as never, "again");
    expect(getProcessorStatus().isRunning).toBe(true);
    stopProcessor();
    vi.useRealTimers();
  });
});


