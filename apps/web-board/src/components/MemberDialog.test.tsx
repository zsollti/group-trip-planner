import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@gtp/api-client";
import type { TripMembersView, TripRole } from "@gtp/types";
import { MemberDialog } from "./MemberDialog";

/**
 * The crew dialog had no test at all, which is how it grew four controls per
 * row — a role `<select>`, Kick, Block and Make owner — without anyone having to
 * say what the row was *for*. This pins the shape it collapsed into: one "⋯" per
 * member, holding the role changes it isn't and the destructive three.
 *
 * What is asserted is the request that leaves, not the state that changed: the
 * list is a server query, so a role change is only real if it PATCHes.
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return { ...actual, useAuth: () => ({ user: { id: "u-me" } }) };
});

const members: TripMembersView = {
  members: [
    {
      userId: "u-me",
      displayName: "Ada Lovelace",
      avatarUrl: null,
      role: "OWNER",
      joinedAt: "2026-01-01T00:00:00.000Z",
      isOwner: true,
    },
    {
      userId: "u-grace",
      displayName: "Grace Hopper",
      avatarUrl: null,
      role: "PARTICIPANT",
      joinedAt: "2026-01-02T00:00:00.000Z",
      isOwner: false,
    },
  ],
  blocked: [],
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/members") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(members), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

function renderDialog(myRole: TripRole = "OWNER") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <MemberDialog tripId="t1" myRole={myRole} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The "⋯" for a named member, once the roster has arrived. */
async function openMenuFor(name: string) {
  const trigger = await screen.findByRole("button", {
    name: `Actions for ${name}`,
  });
  fireEvent.click(trigger);
  return trigger;
}

describe("MemberDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the role on the row, and only the irreversible things in the menu", async () => {
    mockFetch();
    renderDialog();

    // The role is the commonest thing anyone changes here and it was two
    // clicks down a list. It is a control on the row now, and it states the
    // role it holds rather than leaving that to be inferred from which items
    // the menu offers.
    const role = await screen.findByRole("combobox", {
      name: /Role for Grace Hopper/,
    });
    expect(role).toHaveValue("PARTICIPANT");

    await openMenuFor("Grace Hopper");
    // What is left behind the "⋯": the things that cannot be undone from here.
    expect(
      screen.getByRole("button", { name: /Remove from trip/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Remove and block/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Make guest/ })).toBeNull();
  });

  it("says which of the two removals lets someone come back", async () => {
    // The point of the notes. "Remove" and "Block" are the same act with a
    // different afterwards, and no pair of verbs carries that on its own — so
    // each item states the consequence, and it is wired as the button's
    // description rather than folded into its name.
    mockFetch();
    renderDialog();
    await openMenuFor("Grace Hopper");

    const remove = screen.getByRole("button", { name: /Remove from trip/ });
    const block = screen.getByRole("button", { name: /Remove and block/ });
    const noteOf = (el: HTMLElement) =>
      document.getElementById(el.getAttribute("aria-describedby")!)
        ?.textContent;

    expect(noteOf(remove)).toMatch(/invite them back/i);
    expect(noteOf(block)).toMatch(/can't rejoin/i);
  });

  it("wears the same marks the crew strip's quick actions do", async () => {
    // The strip's hover panel offers these three acts as icons and nothing
    // else, so a reader who has used it knows "block" as a shape before they
    // know it as a word. Repeating the shape here means the two surfaces teach
    // each other rather than being two unrelated ways to the same place.
    mockFetch();
    renderDialog();
    await openMenuFor("Grace Hopper");

    for (const name of [/Remove from trip/, /Remove and block/]) {
      const item = screen.getByRole("button", { name });
      expect(item.querySelector(".menu__item-icon svg")).not.toBeNull();
    }
  });

  it("changes a role from the row", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    const role = await screen.findByRole("combobox", {
      name: /Role for Grace Hopper/,
    });
    fireEvent.change(role, { target: { value: "CO_ORGANIZER" } });

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(String(patch?.[0])).toContain("/trips/t1/members/u-grace");
      expect(String((patch?.[1] as RequestInit).body)).toContain(
        "CO_ORGANIZER",
      );
    });
  });

  it("keeps removal behind the menu and a confirmation", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    await openMenuFor("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: /Remove from trip/ }));

    // Nothing has left yet — the menu item asks, it does not act.
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);
    expect(
      screen.getByText(/Remove Grace Hopper from this trip\?/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(String(del?.[0])).toContain("/trips/t1/members/u-grace");
    });
  });

  it("offers no menu on yourself", async () => {
    mockFetch();
    renderDialog();

    // Waiting on the other row's trigger is what proves the roster rendered —
    // asserting an absence before the fetch resolves would pass for the wrong
    // reason.
    await screen.findByRole("button", { name: "Actions for Grace Hopper" });
    expect(
      screen.queryByRole("button", { name: "Actions for Ada Lovelace" }),
    ).toBeNull();
  });

  it("closes with the dialog's own ✕ and nothing else", async () => {
    mockFetch();
    renderDialog("PARTICIPANT");

    await screen.findByText("Grace Hopper");
    // One way out, not two.
    //
    // Queried off the document rather than off the render's `container`: the
    // dialog is portalled into `document.body`, so it is not a descendant of
    // the tree it was written in. That is the whole point of the portal — see
    // `Dialog` — and a test that reached through `container` would be asserting
    // on the layout the modal deliberately escaped.
    const dialog = within(document.querySelector("[role=dialog]")!);
    expect(dialog.queryByRole("button", { name: "Close" })).not.toBeNull();
    expect(dialog.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("does not offer leaving — that is an action on the trip, not on the crew", async () => {
    mockFetch();
    renderDialog("PARTICIPANT");

    // A member is exactly the role that *can* leave, so its absence here has to
    // be asserted against a rendered roster rather than against a pending one:
    // waiting for a name first is what makes this a statement about the finished
    // dialog. Leaving now lives in the trip's own "⋯" (see `TripDetail`).
    await screen.findByText("Grace Hopper");
    expect(screen.queryByRole("button", { name: "Leave trip" })).toBeNull();
  });
});

/**
 * The row's own width, guarded where it was actually lost: the stylesheet.
 *
 * The reported symptom was a "⋯" sitting outside the member's card, with a
 * horizontal scrollbar under a dialog that had nothing to scroll to. Nothing in
 * the markup was wrong. `.board__member-role` sets `width: auto` on the role
 * select and `.board__select` sets `width: 100%` eight hundred lines further
 * down — same specificity, later in the cascade — so the select filled the
 * actions column and pushed the menu button out through the row's border.
 *
 * jsdom applies no stylesheet, so no rendering test can see this; the file can.
 * Written against the rule rather than against the geometry, because the
 * geometry is exactly what is not available here.
 */
describe("the stylesheet's side of the member row", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );

  function selectorsFor(rule: RegExp): string[] {
    return css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0] ?? "")
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter((s) => rule.test(s));
  }

  it("narrows the role select with a rule .board__select cannot outrank", () => {
    const rules = selectorsFor(/board__member-role/);
    expect(rules.length).toBeGreaterThan(0);
    // Every one of them, not just the first: a second bare rule added later
    // would lose the same argument all over again.
    for (const selector of rules) {
      expect(selector).toContain(".board__select.board__member-role");
    }
  });

  /**
   * "(you)" and the role, on the same line as the name.
   *
   * Reported as the reader's own row printing both a little above their name.
   * `.board__muted` is a paragraph class — quiet prose with `margin: 0 0 1.5rem`
   * — and this row, the crew panel and the invite list all use it inline for a
   * word. As a flex item that bottom margin counts: `align-items: center`
   * centres the *margin* box, lifting the text three-quarters of a rem. Only
   * your own row shows it, because it is the only one that prints its role as a
   * word rather than as a `<select>`.
   *
   * Guarded here for the same reason as the rule above: jsdom applies no
   * stylesheet, so the geometry this is about does not exist in a render test.
   */
  it("gives an inline .board__muted no margin to be lifted by", () => {
    const declarations = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{"))
      .filter(([selector]) => (selector ?? "").trim() === "span.board__muted")
      .map(([, body]) => (body ?? "").replace(/\s/g, ""));
    expect(declarations).toEqual(["margin:0;"]);
  });
});
