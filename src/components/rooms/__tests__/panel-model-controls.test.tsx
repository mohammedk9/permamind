import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PanelModelControls } from "../panel-model-controls";

/**
 * The panel member's own model.
 *
 * The rule this surface exists to serve is the one in `panel-rooms-proposal.md` section 5:
 * no one spends someone else's key. That rule is enforced on the server, and this file
 * checks the one thing the server cannot: that the screen does not tell a member something
 * false about who is paying.
 *
 * A member who registers a model and then reads "the model runs on the host's key" will
 * believe the host is paying for their questions. In a panel room that is false, and it is
 * the exact belief the feature exists to remove — so the sentence is asserted here rather
 * than trusted to review.
 */

const registerModel = vi.fn(async () => true);
const withdrawModel = vi.fn(async () => true);

const base = {
  aiSpecialties: ["Critique", "Marketing"],
  aiMaxModels: 3 as number | null,
  registerModel,
  withdrawModel,
  busy: false,
  error: "",
  ar: false,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof PanelModelControls>> = {},
) {
  return render(<PanelModelControls {...base} callerModel={null} {...overrides} />);
}

describe("a member with no model", () => {
  it("says taking part without a key is still taking part", () => {
    renderPanel();

    // Section 6.1: a member not bringing a model is not an error. If the empty state read as
    // a failure, they would register a model they did not want purely to avoid looking like
    // they had not participated.
    expect(screen.getByText(/take part without spending your key/i)).toBeTruthy();
  });

  it("offers the host's roles and nothing else", () => {
    renderPanel();

    const roleSelect = screen.getByRole("combobox", { name: /role/i }) as HTMLSelectElement;
    const options = Array.from(roleSelect.options).map((option) => option.value);

    // Exactly the host's list. A free-text answer is not constructible from this control,
    // which is why the server refusing an unoffered speciality is a backstop rather than the
    // only defence.
    expect(options).toEqual(["Critique", "Marketing"]);
  });

  it("offers a model from the list rather than a text field", () => {
    renderPanel();

    const modelSelect = screen.getByRole("combobox", { name: /model/i }) as HTMLSelectElement;
    expect(modelSelect.options.length).toBeGreaterThan(1);
  });

  it("disables registration until a model is chosen", () => {
    renderPanel();

    const button = screen.getByRole("button", { name: /bring your model/i });
    // The role defaults to the host's first offer, so the model is the only thing missing.
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("never tells the member the host is paying", () => {
    renderPanel();

    expect(screen.queryByText(/host.s key/i)).toBeNull();
    expect(screen.queryByText(/runs on the host/i)).toBeNull();
  });
});

describe("a member with a model", () => {
  const registered = {
    modelId: "openai/gpt-4o",
    modelLabel: "GPT-4o",
    specialty: "Critique",
  };

  it("shows which model they brought and the role it fills", () => {
    renderPanel({ callerModel: registered });

    // Scoped to the registration rather than searched globally: both the label and the role
    // also appear as `<option>`s in the two pickers, so a page-wide query matches four nodes
    // rather than one. The assertion is about what the member is told their model *is*, and
    // that is the badge — the pickers are inputs, not statements.
    const badge = screen.getByText("GPT-4o", { selector: "span.font-medium" });
    expect(badge.textContent).toBe("GPT-4o");

    const role = screen.getByText(/Critique/, { selector: "span.text-muted-foreground" });
    expect(role.textContent).toMatch(/Critique/);
  });

  it("offers withdrawal, which is not a deletion of their seat", () => {
    renderPanel({ callerModel: registered });

    // Withdrawing a model leaves the person in the room. Removing them would make changing
    // one's mind the same as being kicked.
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeTruthy();
  });

  it("still says nobody else's key is spent", () => {
    renderPanel({ callerModel: registered });

    expect(screen.getByText(/never spends anyone else.s/i)).toBeTruthy();
    expect(screen.queryByText(/host.s key/i)).toBeNull();
  });
});

describe("the host's cap", () => {
  it("is shown, so a member knows the bound before being refused by it", () => {
    renderPanel();

    expect(screen.getByText(/Room allows 3 models/i)).toBeTruthy();
  });

  it("is not shown when the host set none", () => {
    renderPanel({ aiMaxModels: null });

    expect(screen.queryByText(/Room allows/i)).toBeNull();
  });
});

describe("a refusal from the server", () => {
  it("is shown as an alert, in the server's own words", () => {
    // The cap message explains which limit was reached. Replacing it with a generic failure
    // would leave a member retrying something that will keep failing.
    renderPanel({ error: "This room has as many models as the host allows" });

    expect(screen.getByRole("alert").textContent).toMatch(
      /as many models as the host allows/i,
    );
  });
});