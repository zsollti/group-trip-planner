import { describe, expect, it } from "vitest";
import type { ChannelView } from "@gtp/types";
import { applyOrder, orderChannels } from "./channelOrder";

function channel(
  id: string,
  lastMessageAt: string | null,
  type: ChannelView["type"] = "CATEGORY",
): ChannelView {
  return {
    id,
    tripId: "trip",
    categoryId: type === "GENERAL" ? null : `cat-${id}`,
    type,
    lastMessageAt,
  };
}

describe("orderChannels", () => {
  it("leads with the trip's own channel however quiet it is", () => {
    const general = channel("general", null, "GENERAL");
    const busy = channel("food", "2026-08-25T12:00:00.000Z");
    expect(
      orderChannels([busy, general], "general").map((c) => c.id),
    ).toEqual(["general", "food"]);
  });

  it("puts the rest most recently spoken in first", () => {
    const ordered = orderChannels(
      [
        channel("general", "2026-08-25T09:00:00.000Z", "GENERAL"),
        channel("stay", "2026-08-25T10:00:00.000Z"),
        channel("food", "2026-08-25T12:00:00.000Z"),
        channel("transport", "2026-08-25T11:00:00.000Z"),
      ],
      "general",
    );
    expect(ordered.map((c) => c.id)).toEqual([
      "general",
      "food",
      "transport",
      "stay",
    ]);
  });

  it("sinks the channels nobody has written in, keeping their own order", () => {
    // Creation order among the silent ones is the only order they have, and it
    // is the order the server sent — a stable sort must not shuffle it.
    const ordered = orderChannels(
      [
        channel("first-made", null),
        channel("second-made", null),
        channel("spoken", "2026-08-25T10:00:00.000Z"),
      ],
      undefined,
    );
    expect(ordered.map((c) => c.id)).toEqual([
      "spoken",
      "first-made",
      "second-made",
    ]);
  });

  it("does not mutate what it is given", () => {
    const input = [
      channel("quiet", null),
      channel("loud", "2026-08-25T10:00:00.000Z"),
    ];
    orderChannels(input, undefined);
    expect(input.map((c) => c.id)).toEqual(["quiet", "loud"]);
  });
});

describe("applyOrder", () => {
  it("replays a remembered order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(applyOrder(items, ["c", "a", "b"])).toEqual([
      { id: "c" },
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("keeps a channel the order has never heard of, at the end", () => {
    // A discussion started live over the socket: it is in the list a render
    // before the re-sort runs, and dropping it for that render would be a chip
    // that flickers away the moment someone opens it.
    const items = [{ id: "a" }, { id: "new" }, { id: "b" }];
    expect(applyOrder(items, ["b", "a"]).map((c) => c.id)).toEqual([
      "b",
      "a",
      "new",
    ]);
  });

  it("ignores an id whose channel is gone", () => {
    // A deleted category takes its channel with it; the remembered order still
    // names it until the next re-sort.
    expect(applyOrder([{ id: "a" }], ["gone", "a"]).map((c) => c.id)).toEqual([
      "a",
    ]);
  });
});
