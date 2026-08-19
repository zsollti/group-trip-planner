import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CategoryView, OptionView } from "@gtp/types";
import { OptionDetail } from "./OptionDetail";

/**
 * The option link is the board's one user-supplied `href` (Phase 7.2). The
 * contract now refuses a non-http(s) scheme on the way in, but rows written
 * before that rule are still in the database — so the render side decides for
 * itself what may become a link. Functional/DOM only (no screenshot tests).
 *
 * The panel around it was rebuilt (it was a two-column `<dl>` that read as the
 * database row behind the card), so what is pinned here alongside the link is
 * the part of that rebuild a reader would notice going wrong: the two headline
 * answers say so when they have no answer, rather than vanishing.
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

function option(
  url: string | null,
  over: Partial<OptionView> = {},
): OptionView {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    categoryId: category.id,
    title: "Beach House",
    description: null,
    url,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    participationMode: "WHOLE_GROUP",
    participants: [],
    viewerIsParticipant: false,
    effectiveHeadcount: 4,
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
    ...over,
  };
}

function show(url: string | null, over: Partial<OptionView> = {}) {
  return render(
    <OptionDetail
      category={category}
      option={option(url, over)}
      onClose={() => {}}
    />,
  );
}

describe("OptionDetail link", () => {
  it("links an ordinary http(s) URL, written the way it reads", () => {
    show("https://www.booking.example/room/9?aid=304142");
    // The label drops the scheme, the `www.` and the query — the href does not.
    const link = screen.getByRole("link", { name: "booking.example/room/9" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.booking.example/room/9?aid=304142",
    );
    // …and the whole address is still one hover away, for anyone checking
    // where a link actually goes before following it.
    expect(link).toHaveAttribute(
      "title",
      "https://www.booking.example/room/9?aid=304142",
    );
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

describe("the two headline answers", () => {
  it("says a question is open rather than dropping the line", () => {
    // The old panel omitted a field it had no value for, so an option nobody
    // had priced looked exactly like an option that is free.
    show(null);
    expect(screen.getByText("No dates yet")).toBeInTheDocument();
    expect(screen.getByText("No price yet")).toBeInTheDocument();
  });

  it("says who a price is for", () => {
    show(null, { amount: 120, costType: "TOTAL", effectiveHeadcount: 4 });
    expect(screen.getByText("for 4 people on the trip")).toBeInTheDocument();
  });

  it("says an opt-in price is split between whoever is in", () => {
    show(null, {
      amount: 120,
      participationMode: "OPT_IN",
      effectiveHeadcount: 2,
    });
    expect(screen.getByText("split between whoever’s in")).toBeInTheDocument();
    // And the panel grows the group that only an opt-in option has.
    expect(screen.getByText("Nobody is in yet.")).toBeInTheDocument();
  });

  it("states whether the option is settled, not just what it holds", () => {
    show(null);
    expect(screen.getByText(/Still being decided/)).toBeInTheDocument();
  });
});
