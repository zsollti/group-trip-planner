import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, useReorderTrips } from "@gtp/api-client";
import type { ReactNode } from "react";

/**
 * What a drag on the overview actually sends.
 *
 * Dragging a trip tile did nothing at all: the tile went back where it came
 * from wherever it was dropped. Nothing in the board could see it, because the
 * board's own test mocks `useReorderTrips` away — and nothing in the API could
 * see it either, because the request never got past validation. The mutation
 * passed `JSON.stringify({ tripIds })` as its body and `apiFetch` serializes
 * what it is given, so the server was sent a JSON *string* where its schema
 * wanted an object, answered 400, and the optimistic order rolled back.
 *
 * So this asserts on the **bytes on the wire**, which is the only place the two
 * halves of that mistake meet. The sweep below then holds the whole client to
 * it: one call site doing its own serializing is a bug the type system cannot
 * see, since `body` is `unknown` by design (FormData goes through it too).
 */

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useReorderTrips", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the ids as an object the server's schema can parse", async () => {
    const { result } = renderHook(() => useReorderTrips(), { wrapper });
    result.current.mutate(["a", "b"]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A double-stringified body parses to a *string*, and looks fine until you
    // ask what shape it is — which is exactly why this went unnoticed.
    expect(JSON.parse(String(init.body))).toEqual({ tripIds: ["a", "b"] });
  });
});

/** The client's source, which the sweep below reads. */
const CLIENT_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "api-client",
  "src",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("api-client request bodies", () => {
  it("never serializes a body at the call site", () => {
    // `apiFetch` is the one place that decides how a body is encoded — it has
    // to be, because it also has to leave FormData alone. A caller that
    // stringifies first hands it a string, which it then stringifies again.
    const offenders = sourceFiles(CLIENT_SRC)
      .filter((file) => !file.endsWith("http.ts"))
      .filter((file) =>
        /body:\s*JSON\.stringify/.test(readFileSync(file, "utf8")),
      )
      .map((file) => file.replace(CLIENT_SRC, ""));

    expect(offenders).toEqual([]);
  });
});
