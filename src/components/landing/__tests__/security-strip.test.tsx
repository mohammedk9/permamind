import React from "react";
import { render, screen } from "@testing-library/react";
import { SecurityStrip, type SecurityStripCopy } from "@/components/landing/security-strip";
import {
  ENCRYPTION_ALGORITHM,
  FREE_STORAGE_QUOTA_MB,
  KDF_ITERATIONS,
  MAX_UPLOAD_SIZE_MB,
} from "@/lib/arweave/constants";

const copy: SecurityStripCopy = {
  securityTitle: "Security you can verify",
  securityCipher: "Encrypted before any upload",
  securityKdf: "iterations",
  storageNote: (freeMb) => `max per upload · ${freeMb} free`,
};

describe("Security strip", () => {
  it("shows the encryption algorithm the app actually uses", () => {
    render(<SecurityStrip copy={copy} />);
    expect(screen.getByText(ENCRYPTION_ALGORITHM)).toBeTruthy();
  });

  it("shows the real key-derivation work factor, not a rounded marketing number", () => {
    render(<SecurityStrip copy={copy} />);
    expect(KDF_ITERATIONS).toBe(310_000);
    expect(screen.getByText("310K")).toBeTruthy();
  });

  it("pairs the upload cap with the free allowance", () => {
    render(<SecurityStrip copy={copy} />);
    expect(screen.getByText(`${MAX_UPLOAD_SIZE_MB} MB`)).toBeTruthy();
    expect(screen.getByText(`max per upload · ${FREE_STORAGE_QUOTA_MB} MB free`)).toBeTruthy();
  });

  it("renders exactly three figures so the strip cannot grow into a wall of text", () => {
    render(<SecurityStrip copy={copy} />);
    expect(screen.getAllByRole("definition")).toHaveLength(3);
  });

  it("keeps the numbers and the title in both locales", () => {
    render(<SecurityStrip copy={copy} />);
    expect(screen.getByText(copy.securityTitle)).toBeTruthy();
  });
});