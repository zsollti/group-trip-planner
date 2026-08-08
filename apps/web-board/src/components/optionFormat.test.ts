import { describe, expect, it } from "vitest";
import { dateRangeLabel } from "./optionFormat";

/**
 * The card's date label, at the two precisions a category can capture.
 *
 * Formatting is locale- and zone-dependent by design (the server stores
 * instants and never formats them), so these assert the **composition** — which
 * parts appear and which are dropped — against the same `Intl` calls the label
 * itself makes, rather than pinning en-US strings a different CI locale would
 * break.
 */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const morning = new Date("2026-09-06T07:15").toISOString();
const noon = new Date("2026-09-06T11:40").toISOString();
const nextDay = new Date("2026-09-07T06:00").toISOString();

describe("dateRangeLabel", () => {
  it("is absent when the option has no dates at all", () => {
    expect(dateRangeLabel(null, null, "day")).toBeNull();
    expect(dateRangeLabel(null, null, "minute")).toBeNull();
  });

  it("shows days alone at day granularity", () => {
    const label = dateRangeLabel(morning, nextDay, "day");
    expect(label).toBe(`${day(morning)} – ${day(nextDay)}`);
    // The time is the part that means nothing here — a Dates option proposes
    // calendar days, and its stored time is an artefact of the midday-UTC rule.
    expect(label).not.toContain(time(morning));
  });

  it("shows the time at minute granularity, because that is the useful part", () => {
    // A flight is not "Jul 6", it is "Jul 6, 07:15".
    expect(dateRangeLabel(morning, null, "minute")).toBe(
      `${day(morning)}, ${time(morning)}`,
    );
  });

  it("does not repeat the date when both ends fall on the same day", () => {
    // The common case for a transfer or an activity.
    expect(dateRangeLabel(morning, noon, "minute")).toBe(
      `${day(morning)}, ${time(morning)} – ${time(noon)}`,
    );
  });

  it("keeps both dates when the range crosses midnight", () => {
    expect(dateRangeLabel(morning, nextDay, "minute")).toBe(
      `${day(morning)}, ${time(morning)} – ${day(nextDay)}, ${time(nextDay)}`,
    );
  });

  it("labels a single date from whichever end is present", () => {
    expect(dateRangeLabel(null, noon, "day")).toBe(day(noon));
    expect(dateRangeLabel(morning, null, "day")).toBe(day(morning));
  });
});
