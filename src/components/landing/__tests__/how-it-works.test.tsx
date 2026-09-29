import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HowItWorks, type HowItWorksCopy } from "@/components/landing/how-it-works";
import { translations } from "@/lib/i18n/translations";

const copy = translations.en as unknown as HowItWorksCopy;
const selected = (name: RegExp) =>
  screen.getByRole("tab", { name }).getAttribute("aria-selected");

describe("How it works section", () => {
  it("renders the four steps as a tab list with the first one selected", () => {
    render(<HowItWorks copy={copy} rtl={false} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  });

  it("swaps the live preview when a step is selected", () => {
    render(<HowItWorks copy={copy} rtl={false} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(copy.howPreview.chatUser)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Keep the context/ }));
    expect(within(panel).getByText(copy.howPreview.extractTitle)).toBeTruthy();
    expect(within(panel).getByText(copy.howPreview.extractItems[0])).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Preserve what matters/ }));
    expect(within(panel).getByText(copy.stageEncrypted)).toBeTruthy();
    expect(within(panel).getByText(copy.stagePermanent)).toBeTruthy();
  });

  it("moves between steps with the arrow keys following reading order", () => {
    render(<HowItWorks copy={copy} rtl={false} />);

    fireEvent.keyDown(screen.getByRole("tab", { name: /Chat naturally/ }), { key: "ArrowDown" });
    expect(selected(/Keep the context/)).toBe("true");

    fireEvent.keyDown(screen.getByRole("tab", { name: /Keep the context/ }), { key: "ArrowUp" });
    expect(selected(/Chat naturally/)).toBe("true");
  });

  it("flips the arrow direction in RTL", () => {
    render(<HowItWorks copy={copy} rtl />);

    fireEvent.keyDown(screen.getByRole("tab", { name: /Chat naturally/ }), { key: "ArrowLeft" });
    expect(selected(/Keep the context/)).toBe("true");

    fireEvent.keyDown(screen.getByRole("tab", { name: /Keep the context/ }), {
      key: "ArrowRight",
    });
    expect(selected(/Chat naturally/)).toBe("true");
  });

  it("wraps around at both ends of the step list", () => {
    render(<HowItWorks copy={copy} rtl={false} />);

    // Backwards from the first step lands on the last one.
    fireEvent.keyDown(screen.getByRole("tab", { name: /Chat naturally/ }), { key: "ArrowUp" });
    expect(selected(/Preserve what matters/)).toBe("true");

    // Forwards from the last step returns to the first.
    fireEvent.keyDown(screen.getByRole("tab", { name: /Preserve what matters/ }), {
      key: "ArrowDown",
    });
    expect(selected(/Chat naturally/)).toBe("true");
  });

  it("exposes an anchor target for the hero call to action", () => {
    render(<HowItWorks copy={copy} rtl={false} />);
    expect(document.getElementById("how")).toBeTruthy();
  });
});