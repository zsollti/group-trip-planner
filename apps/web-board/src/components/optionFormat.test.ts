import { describe, expect, it } from "vitest";
import type { OptionView } from "@gtp/types";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { intlTag } from "../lib/locale";

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
  new Date(iso).toLocaleDateString(intlTag(), {
    month: "short",
    day: "numeric",
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(intlTag(), {
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

/**
 * The cost label, which had no test until it started grouping its digits.
 *
 * Same rule as the dates above: the separator and the symbol placement are the
 * reader's locale's business, so what is asserted is that the digits survive,
 * that they are no longer one run, and that the cost type is named.
 */
describe("costLabel", () => {
  const priced = (over: Partial<OptionView>): OptionView =>
    ({
      amount: 45000,
      currency: "EUR",
      costType: "PER_PERSON",
      ...over,
    }) as OptionView;

  it("returns nothing for an option with no price", () => {
    expect(costLabel(priced({ amount: null }))).toBeNull();
  });

  it("groups a long amount instead of running the digits together", () => {
    const label = costLabel(priced({}))!;
    expect(label).not.toContain("45000");
    expect(label.replace(/\D/g, "")).toBe("45000");
  });

  it("names which kind of cost it is", () => {
    expect(costLabel(priced({}))).toContain("/person");
    expect(costLabel(priced({ costType: "TOTAL" }))).toContain("total");
  });

  it("survives a currency Intl cannot render", () => {
    // `currencySchema` accepts any three letters, so a made-up code must not
    // throw inside a card's render.
    const label = costLabel(priced({ currency: "ZZZ" }))!;
    expect(label).toContain("ZZZ");
  });
});
