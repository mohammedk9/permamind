import React from 'react';
import { render, screen } from "@testing-library/react";
import { HowPermaMindWorksContent } from "@/components/help/how-permamind-works";

describe("How PermaMind Works help", () => {
  it("renders the user-friendly help sections", () => {
    render(<HowPermaMindWorksContent />);
    expect(screen.getByText("Your conversations, remembered")).toBeTruthy();
    expect(screen.getByText(/Traditional AI remembers only the current conversation/)).toBeTruthy();
    expect(screen.getByText("Export your memory")).toBeTruthy();
    expect(screen.queryByText(/OpenRouter|Queue|Snapshots|Transaction IDs|Deduplication|Pipeline|Registry/)).toBeNull();
  });
});




