import React from "react";
import { render, screen } from "@testing-library/react";

import { VaultFlow } from "@/components/landing/vault-flow";
import { ProductStage } from "@/components/landing/provider-showcase";
import { translations } from "@/lib/i18n/translations";

/**
 * The encrypted-then-permanent claim appeared twice on the page. These tests
 * hold both call sites to the same three facts so the copy cannot drift apart
 * again: the cipher badge, the Arweave logo, and the local-encryption line.
 */
const copy = {
  stageEncrypted: translations.en.stageEncrypted,
  stageCipher: translations.en.stageCipher,
  stagePermanent: translations.en.stagePermanent,
};

describe("Vault flow", () => {
  it("shows the cipher, the encrypted label, and the permanent label", () => {
    render(<VaultFlow {...copy} rtl={false} />);

    expect(screen.getByText("AES")).toBeTruthy();
    expect(screen.getByText(copy.stageEncrypted)).toBeTruthy();
    expect(screen.getByText(copy.stageCipher)).toBeTruthy();
    expect(screen.getByText(copy.stagePermanent)).toBeTruthy();
  });

  it("names Arweave as the permanent destination", () => {
    render(<VaultFlow {...copy} rtl={false} />);
    expect(screen.getByText("Arweave")).toBeTruthy();
  });

  it("animates the arrow only when asked", () => {
    const { container, rerender } = render(
      <VaultFlow {...copy} rtl={false} variant="panel" animated />,
    );
    expect(container.querySelector(".how-arrow-pulse")).toBeTruthy();

    rerender(<VaultFlow {...copy} rtl={false} variant="stage" />);
    expect(container.querySelector(".how-arrow-pulse")).toBeNull();
  });

  it("flips the arrow in RTL", () => {
    const { container } = render(<VaultFlow {...copy} rtl />);
    expect(container.querySelector(".rotate-180")).toBeTruthy();
  });

  it("hides the arrow in the compact strip on narrow screens", () => {
    const { container } = render(
      <VaultFlow {...copy} rtl={false} variant="stage" />,
    );
    // The strip collapses to one column on mobile, where an arrow between two
    // stacked blocks reads as noise.
    expect(container.querySelector(".hidden")).toBeTruthy();
  });

  it("is what ProductStage renders, so the two copies stay identical", () => {
    render(
      <ProductStage
        stages={[]}
        question="q"
        answer="a"
        source="s"
        encrypted={copy.stageEncrypted}
        cipher={copy.stageCipher}
        permanent={copy.stagePermanent}
        rtl={false}
      />,
    );

    expect(screen.getByText(copy.stageEncrypted)).toBeTruthy();
    expect(screen.getByText(copy.stageCipher)).toBeTruthy();
    expect(screen.getByText(copy.stagePermanent)).toBeTruthy();
  });
});
