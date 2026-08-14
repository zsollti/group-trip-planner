import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CategoryView, OptionView } from "@gtp/types";
import { OptionDetail } from "./OptionDetail";

/**
 * The option link is the board's one user-supplied `href` (Phase 7.2). The
 * contract now refuses a non-http(s) scheme on the way in, but rows written
 * before that rule are still in the database — so the render side decides for
 * itself what may become a link. Functional/DOM only (no screenshot tests).
 */

const category: CategoryView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Stay",
  singleChoice: true,
  isBuiltin: true,
  builtinKey: "ACCOMMODATION",
  paletteKey: null,
  position: 0,
  version: 0,
};

function option(url: string | null): OptionView {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    categoryId: category.id,
    title: "Beach House",
    description: null,
    url,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    startsAt: null,
    endsAt: null,
    externalRef: null,
    status: "PROPOSED",
    version: 0,
    proposerId: "44444444-4444-4444-8444-444444444444",
    proposerName: "Ada",
    materialChangedAt: null,
    createdAt: "2026-07-27T10:00:00.000Z",
    lockedByName: null,
    lockedAt: null,
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
  };
}

function show(url: string | null) {
  return render(
    <OptionDetail
      category={category}
      option={option(url)}
      onClose={() => {}}
    />,
  );
}

describe("OptionDetail link", () => {
  it("links an ordinary http(s) URL", () => {
    show("https://booking.example/room/9");
    const link = screen.getByRole("link", {
      name: "https://booking.example/room/9",
    });
    expect(link).toHaveAttribute("href", "https://booking.example/room/9");
    // Opening in a new tab must not hand the opener over.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows a javascript: URL as inert text rather than a link", () => {
    show("javascript:alert(document.cookie)");
    // Still visible — the viewer can see what was stored...
    expect(
      screen.getByText("javascript:alert(document.cookie)"),
    ).toBeInTheDocument();
    // ...but there is nothing to click.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a data: URL as inert text too", () => {
    show("data:text/html,<script>alert(1)</script>");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
