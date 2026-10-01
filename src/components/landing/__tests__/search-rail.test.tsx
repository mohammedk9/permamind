import React from "react";
import { render, screen } from "@testing-library/react";

import { SearchRail } from "@/components/landing/search-rail";
import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from "@/lib/search/provider";
import { translations } from "@/lib/i18n/translations";

/**
 * The rail must follow `SEARCH_PROVIDERS` rather than a hand-written list, so the
 * landing page cannot advertise fewer providers than the server can actually
 * reach. That is the whole reason this section reads from the registry.
 */
describe("Search rail", () => {
  const copy = translations.en;

  it("renders one entry per registered provider", () => {
    render(<SearchRail copy={copy} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(SEARCH_PROVIDERS.length);
    expect(items.length).toBe(3);
  });

  it("names the providers a user can recognise", () => {
    render(<SearchRail copy={copy} />);

    expect(screen.getByText("Exa")).toBeTruthy();
    expect(screen.getByText("AnySearch")).toBeTruthy();
    expect(screen.getByText("Google Grounding")).toBeTruthy();
  });

  it("marks exactly the default provider", () => {
    const { container } = render(<SearchRail copy={copy} />);

    const marked = container.querySelectorAll('[data-default="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("Exa");
    expect(DEFAULT_SEARCH_PROVIDER).toBe("exa");
  });

  it("uses the heading and description from the translation bundle", () => {
    render(<SearchRail copy={copy} />);

    expect(screen.getByRole("heading", { name: copy.searchTitle })).toBeTruthy();
    expect(screen.getByText(copy.searchDescription)).toBeTruthy();
  });

  it("does not render the stale 'Coming soon' badge", () => {
    // `searchBadge` still reads "Coming soon · Beta", which stopped being true
    // once the second and third providers shipped. Rendering it again would put
    // the page back in contradiction with the code.
    render(<SearchRail copy={copy} />);

    expect(screen.queryByText(copy.searchBadge)).toBeNull();
  });

  it("exposes an anchor target for the header navigation", () => {
    render(<SearchRail copy={copy} />);
    expect(document.getElementById("search")).toBeTruthy();
  });

  it("renders the Arabic bundle without inventing English prose", () => {
    render(<SearchRail copy={translations.ar} />);

    expect(screen.getByRole("heading", { name: translations.ar.searchTitle })).toBeTruthy();
    expect(screen.getByText(translations.ar.searchDescription)).toBeTruthy();
  });
});
