import { describe, expect, it, vi } from "vitest";

const { createTransactionMock, signMock } = vi.hoisted(() => ({
  createTransactionMock: vi.fn(async (input: { data: ArrayBuffer }) => ({ id: "tx", addTag: vi.fn(), data: new Uint8Array(input.data) })),
  signMock: vi.fn(),
}));
vi.mock("arweave", () => ({ default: { init: () => ({ createTransaction: createTransactionMock, transactions: { sign: signMock } }) } }));

import { createTransaction } from "../arweave-client";

describe("createTransaction payload range", () => {
  it("passes only the Uint8Array view range", async () => {
    const backing = new Uint8Array([9, 8, 1, 2, 3, 7]);
    await createTransaction(backing.subarray(2, 5), [], {} as never);
    expect([...new Uint8Array(createTransactionMock.mock.calls[0][0].data)]).toEqual([1, 2, 3]);
  });
});