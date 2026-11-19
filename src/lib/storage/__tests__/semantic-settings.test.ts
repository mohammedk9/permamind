import { beforeEach, describe, expect, it } from "vitest";

import {
  loadSemanticPreference,
  saveSemanticPreference,
} from "@/lib/storage/semantic-settings";

const KEY = "permamind:semantic-memory:v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("semantic memory preference", () => {
  it("is off until the user turns it on", () => {
    // Nobody should pay a 150 MB download for a feature they never asked for.
    expect(loadSemanticPreference()).toBe(false);
  });

  it("remembers that the user turned it on", () => {
    saveSemanticPreference(true);

    expect(window.localStorage.getItem(KEY)).toBe("on");
    expect(loadSemanticPreference()).toBe(true);
  });

  it("remembers that the user turned it off", () => {
    saveSemanticPreference(true);
    saveSemanticPreference(false);

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(loadSemanticPreference()).toBe(false);
  });

  it("treats an unexpected value as off", () => {
    window.localStorage.setItem(KEY, "yes");

    expect(loadSemanticPreference()).toBe(false);
  });

  it("does not throw when storage is blocked", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };

    try {
      expect(loadSemanticPreference()).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});