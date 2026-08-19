import { describe, expect, it } from "vitest";
import { applyOrder } from "./pendingOrder";

/**
 * The hold a drop keeps until the server answers.
 *
 * What it has to get right is the awkward middle: the list underneath is still
 * the server's, it can gain and lose members while the request is in flight, and
 * whatever comes out must be a complete list — the lane is rendered from it.
 */
describe("applyOrder", () => {
  const lanes = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ] as const satisfies readonly { id: string }[];
  const key = (l: { id: string }) => l.id;

  it("leaves the list alone when nothing is being held", () => {
    expect(applyOrder(lanes, null, key)).toEqual([...lanes]);
  });

  it("puts the list in the order the drop made", () => {
    expect(applyOrder(lanes, ["c", "a", "b"], key).map(key)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps something the hold has never heard of", () => {
    // Someone else proposed a card while the request was in flight. One round
    // trip out of place beats disappearing from the lane.
    const withNew = [...lanes, { id: "d" }];
    expect(applyOrder(withNew, ["c", "a", "b"], key).map(key)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("keeps the server's own order among everything it does not rank", () => {
    const withNew = [...lanes, { id: "d" }, { id: "e" }];
    expect(applyOrder(withNew, ["b"], key).map(key)).toEqual([
      "b",
      "a",
      "c",
      "d",
      "e",
    ]);
  });

  it("does not mind an id that has since gone", () => {
    // A card deleted in another tab is named by the hold and absent from the
    // list; it simply ranks nothing.
    expect(applyOrder(lanes, ["gone", "c", "b", "a"], key).map(key)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("does not mutate the list it is given", () => {
    const input = [...lanes];
    applyOrder(input, ["c", "b", "a"], key);
    expect(input.map(key)).toEqual(["a", "b", "c"]);
  });
});
