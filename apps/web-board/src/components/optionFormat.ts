import type { OptionView } from "@gtp/types";

/** Compact money label for an option card, e.g. "480 EUR total" / "120 EUR/person". */
export function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${o.amount} ${o.currency}${per}`;
}

/** Short date-range label for a card, e.g. "Jul 3 – Jul 10" (or a single date). */
export function dateRangeLabel(
  startsAt: string | null,
  endsAt: string | null,
): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  return fmt((startsAt ?? endsAt) as string);
}
