import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import {
  createQueryClient,
  useBoardLiveSync,
  useCategoryOptions,
  useToggleVote,
  useTrip,
  useTripCategories,
  useTripDashboard,
} from "@gtp/api-client";
import { OPTIONS_CHANGED_EVENT, type OptionsChanged } from "@gtp/types";

/**
 * What one action costs the network.
 *
 * The board keeps four live queries per screen — the lane's options, the cost
 * dashboard, the category list and the trip detail — and for a long time every
 * write refreshed all of them twice: once from the mutation, then again when
 * the server's own broadcast arrived back at the client that caused it. Voting
 * is the thing members do most and the thing that can change least, and it was
 * costing six requests.
 *
 * These are the tests that keep that from coming back. They assert on the
 * **URLs actually fetched**, not on the invalidation calls, because the two
 * come apart: `invalidateQueries` against a key nothing is mounted on is free,
 * and a `setQueryData` that silently misses its cache is not. Only the request
 * log tells the truth about either.
 */

const JSON_HEADERS = { "content-type": "application/json" };
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

const OPTION = {
  id: "o1",
  categoryId: "c1",
  title: "Hostel",
  description: null,
  url: null,
  amount: null,
  currency: "EUR",
  costType: "PER_PERSON",
  participationMode: "WHOLE_GROUP",
  participants: [],
  viewerIsParticipant: false,
  effectiveHeadcount: 2,
  startsAt: null,
  endsAt: null,
  externalRef: null,
  status: "PROPOSED",
  version: 0,
  proposerId: "u1",
  proposerName: "Ada",
  materialChangedAt: null,
  createdAt: new Date().toISOString(),
  lockedByName: null,
  lockedAt: null,
  voteCount: 0,
  voters: [],
  viewerHasVoted: false,
};

/** The same option as the server would answer a cast vote with. */
const VOTED_OPTION = {
  ...OPTION,
  voteCount: 1,
  voters: [{ userId: "u1", displayName: "Ada", avatarUrl: null }],
  viewerHasVoted: true,
};

/** Every request the app made, in order, path-only. */
let calls: string[] = [];

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("/options") && init?.method === "POST") {
        return json(VOTED_OPTION);
      }
      if (path.includes("/options")) return json([OPTION]);
      if (path.includes("/dashboard")) {
        return json({
          committed: [],
          projected: [],
          viewerCommitted: [],
          lines: [],
          memberCount: 2,
        });
      }
      if (path.includes("/categories")) {
        return json([
          {
            id: "c1",
            name: "Stay",
            singleChoice: true,
            isBuiltin: true,
            builtinKey: "ACCOMMODATION",
            paletteKey: null,
            position: 0,
            version: 0,
          },
        ]);
      }
      return json({
        id: "t1",
        name: "Trip",
        destination: null,
        startDate: null,
        endDate: null,
        status: "ACTIVE",
        role: "OWNER",
        memberCount: 2,
        defaultCurrency: "EUR",
        coverImageUrl: null,
        viewerMuted: false,
        budgetTarget: null,
      });
    }),
  );
}

/**
 * A stand-in for the trip socket that lets a test play the server. Only the
 * three methods {@link useBoardLiveSync} touches are real.
 */
function fakeSocket(): {
  socket: Socket;
  emit: (payload: OptionsChanged) => void;
} {
  const handlers = new Map<string, (payload: OptionsChanged) => void>();
  const socket = {
    on: (event: string, fn: (payload: OptionsChanged) => void) => {
      handlers.set(event, fn);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
  } as unknown as Socket;
  return {
    socket,
    emit: (payload) => handlers.get(OPTIONS_CHANGED_EVENT)?.(payload),
  };
}

/** Mounts exactly the queries a board screen keeps live, plus the vote hook. */
function Harness({
  socket,
  onVote,
}: {
  socket: Socket;
  onVote: (fn: () => void) => void;
}) {
  useTrip("t1");
  useTripCategories("t1");
  useCategoryOptions("t1", "c1");
  useTripDashboard("t1");
  useBoardLiveSync(socket, "t1");
  const vote = useToggleVote("t1", "c1");
  onVote(() => vote.mutate({ optionId: "o1", hasVoted: false }));
  return null;
}

async function mountBoard(): Promise<{
  vote: () => void;
  emit: (payload: OptionsChanged) => void;
}> {
  const { socket, emit } = fakeSocket();
  let vote: () => void = () => {};
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness
        socket={socket}
        onVote={(fn) => {
          vote = fn;
        }}
      />
    </QueryClientProvider>,
  );
  // All four screen queries have landed before any test starts counting.
  await waitFor(() => expect(calls).toHaveLength(4));
  calls = [];
  return { vote: () => vote(), emit };
}

/** Give React Query a beat to run any refetch an action scheduled. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

beforeEach(() => {
  calls = [];
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what a write costs the network", () => {
  it("spends one request on a vote, and re-reads only the money", async () => {
    const { vote } = await mountBoard();
    vote();
    await waitFor(() =>
      expect(calls).toContain("POST /trips/t1/categories/c1/options/o1/votes"),
    );
    await settle();

    // The lane is NOT re-read: the POST already answered with the option as
    // this voter sees it, and that answer went into the cache.
    expect(calls).not.toContain("GET /trips/t1/categories/c1/options");
    // The dashboard is, because a vote can move the front-runner.
    expect(calls).toContain("GET /trips/t1/dashboard");
    // And nothing reaches the two queries a vote cannot possibly change.
    expect(calls).not.toContain("GET /trips/t1/categories");
    expect(calls).not.toContain("GET /trips/t1");
    expect(calls).toHaveLength(2);
  });

  it("shows the vote without waiting for a refetch", async () => {
    const client = createQueryClient();
    const { socket } = fakeSocket();
    let vote: () => void = () => {};
    render(
      <QueryClientProvider client={client}>
        <Harness
          socket={socket}
          onVote={(fn) => {
            vote = fn;
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls).toHaveLength(4));
    vote();

    // The proof that the response was used rather than discarded: the cached
    // lane carries the new tally, and no GET went out to fetch it.
    await waitFor(() => {
      const lane = client.getQueryData<(typeof OPTION)[]>([
        "options",
        "list",
        "t1",
        "c1",
      ]);
      expect(lane?.[0]?.voteCount).toBe(1);
      expect(lane?.[0]?.viewerHasVoted).toBe(true);
    });
  });
});

describe("what a broadcast costs each viewer", () => {
  it("re-reads the lane and the money for an ordinary option change", async () => {
    const { emit } = await mountBoard();
    emit({ tripId: "t1", categoryId: "c1", kind: "option" });
    await settle();

    expect(calls).toContain("GET /trips/t1/categories/c1/options");
    expect(calls).toContain("GET /trips/t1/dashboard");
    expect(calls).not.toContain("GET /trips/t1/categories");
    expect(calls).not.toContain("GET /trips/t1");
  });

  it("re-reads everything for a decision, which really can move everything", async () => {
    const { emit } = await mountBoard();
    emit({ tripId: "t1", categoryId: "c1", kind: "decision" });
    await settle();

    // A lock supersedes a sibling (category version) and can write the trip's
    // own dates, so this is the one kind that has earned the full sweep.
    expect(calls).toContain("GET /trips/t1/categories/c1/options");
    expect(calls).toContain("GET /trips/t1/dashboard");
    expect(calls).toContain("GET /trips/t1/categories");
    expect(calls).toContain("GET /trips/t1");
  });

  it("re-paints a renamed lane without re-reading its options", async () => {
    const { emit } = await mountBoard();
    emit({ tripId: "t1", categoryId: "c1", kind: "category" });
    await settle();

    expect(calls).toContain("GET /trips/t1/categories");
    // The dashboard labels its lines with the category's name and palette.
    expect(calls).toContain("GET /trips/t1/dashboard");
    expect(calls).not.toContain("GET /trips/t1/categories/c1/options");
  });

  it("falls back to refreshing everything when the server sends no kind", async () => {
    const { emit } = await mountBoard();
    // An older API across a rolling deploy. Refreshing too much is the old
    // behaviour and merely wasteful; refreshing too little would drop a
    // decision on the floor for as long as the deploy takes.
    emit({ tripId: "t1", categoryId: "c1" });
    await settle();

    expect(calls).toContain("GET /trips/t1/categories/c1/options");
    expect(calls).toContain("GET /trips/t1/dashboard");
    expect(calls).toContain("GET /trips/t1/categories");
    expect(calls).toContain("GET /trips/t1");
  });

  it("ignores a broadcast about a different trip", async () => {
    const { emit } = await mountBoard();
    emit({ tripId: "other", categoryId: "c1", kind: "decision" });
    await settle();

    expect(calls).toHaveLength(0);
  });
});
