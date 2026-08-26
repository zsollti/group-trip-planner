import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { InviteDialog } from "./InviteDialog";

/**
 * What the list of invite links shows, which is now only what can still be used.
 *
 * Worth pinning because the rule is a filter and a filter is invisible: a
 * regression here does not throw or look broken, it just quietly puts spent
 * links back above the live ones.
 */
const TRIP_ID = "11111111-1111-4111-8111-111111111111";

const link = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type: "GLOBAL",
  role: "PARTICIPANT",
  token: "tok",
  sentToEmail: null,
  disabledAt: null,
  consumedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

function renderWith(links: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const body = method === "GET" ? links : link();
    void input;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <InviteDialog tripId={TRIP_ID} myRole="OWNER" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("the list of invite links", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists a link that can still be used", async () => {
    renderWith([link()]);
    expect(await screen.findByText("Existing links")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  it("leaves out a revoked link and a personal one that has been used", async () => {
    renderWith([
      link({ disabledAt: "2026-08-02T00:00:00.000Z" }),
      link({ type: "PERSONAL", consumedAt: "2026-08-02T00:00:00.000Z" }),
    ]);

    // Neither can do anything ever again, so neither is a row you could act on.
    expect(
      await screen.findByText("No links to show. Create one above."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("holds back its heading when there is nothing under it", async () => {
    renderWith([link({ disabledAt: "2026-08-02T00:00:00.000Z" })]);
    await screen.findByText("No links to show. Create one above.");
    expect(screen.queryByText("Existing links")).toBeNull();
  });

  it("keeps a personal link that has been sent but not yet accepted", async () => {
    renderWith([link({ type: "PERSONAL", sentToEmail: "sam@example.com" })]);
    expect(await screen.findByText(/sam@example.com/)).toBeInTheDocument();
  });

  it("removes a link through the same endpoint the button always used", async () => {
    renderWith([link()]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    // The mutation is a request, so the assertion has to wait for it rather
    // than read the calls on the tick the click happened.
    await waitFor(() => {
      const deletes = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(
          ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
        );
      expect(deletes).toHaveLength(1);
    });
  });
});

/**
 * The two questions on this form are the same question, so they are the same
 * control — a mark, a name, a colon, a sentence, on one line each.
 *
 * The role picker used to stack the name over the sentence, which made a list
 * of three options look like a different kind of control from the list of two
 * directly above it. Asserted on the shape rather than the words: what broke
 * before was the layout, and the words are already pinned by the catalogue.
 */
describe("the two pickers on the invite form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks both questions in the same shape", () => {
    renderWith([]);

    const label = (name: RegExp) =>
      screen.getByRole("radio", { name }).closest("label")!;

    // Each radio's label is one run of text with the name inside it, not a
    // name and a note as two blocks.
    for (const [name, blurb] of [
      [/^Global/, /anyone with the link can join/],
      [/^Organizer/, /runs the trip with you/],
      [/^Traveler/, /comes along/],
      [/^Guest/, /just looks/],
    ] as const) {
      const text = label(name).textContent ?? "";
      expect(text).toMatch(blurb);
      // The colon is the join, and there is exactly one of them: the blurbs
      // used to open with a clause and a colon of their own, which put two in
      // a row the moment the name led the line.
      expect(text.match(/:/g) ?? []).toHaveLength(1);
    }

    // And the mark leads the line, in both groups.
    expect(
      label(/^Global/).querySelector("span > svg:first-child"),
    ).not.toBeNull();
    expect(
      label(/^Organizer/).querySelector("span > svg:first-child"),
    ).not.toBeNull();
  });
});
