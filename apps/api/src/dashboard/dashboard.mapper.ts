import type { Option } from "@prisma/client";
import {
  convertSubtotals,
  crossRate,
  type ConvertedCost,
  type ConvertedLine,
  type CostDashboard,
  type CostEngineOption,
  type CostType,
  type DashboardLine,
  type DashboardLineKind,
  type DashboardSubtotal,
  type OptionStatus,
  type ParticipationMode,
  type TripDashboardView,
} from "@gtp/types";
import type { StoredRates } from "../rates/rates.service.js";

/**
 * The Prisma include that hydrates everything the dashboard needs in **one**
 * query (NFR-1, no N+1): each option's category name and its vote tally (via a
 * relation `_count`, resolved in the same SQL statement — never per row).
 */
/**
 * Everything the dashboard needs from an option, in one statement.
 *
 * A **function** of the viewer, because the payload now answers a question
 * about them: which of these am I paying for? The `participants` include is
 * filtered to their own row, so it costs no extra query and returns at most one
 * row per option rather than the whole list.
 */
export const dashboardOptionInclude = (viewerId: string) =>
  ({
    category: { select: { id: true, name: true } },
    // Counted in the same statement as the votes, never per row: an OPT_IN
    // option's headcount *is* this number, so the engine needs it for every
    // option it prices.
    _count: { select: { votes: true, participants: true } },
    participants: { where: { userId: viewerId }, select: { userId: true } },
  }) as const;

export type DashboardOptionRow = Option & {
  category: { id: string; name: string };
  _count: { votes: number; participants: number };
  /** The viewer's own participation row, or empty. Never the whole list. */
  participants: { userId: string }[];
};

/**
 * Does this viewer pay for this option?
 *
 * Whole-group options are everyone's. An opt-in option is only the people who
 * said so — and `participants` here is already filtered to the viewer, so its
 * presence *is* the answer.
 */
function viewerOwes(row: DashboardOptionRow): boolean {
  return row.participationMode !== "OPT_IN" || row.participants.length > 0;
}

/** A stored option row → the lean shape the pure cost engine consumes. */
export function toEngineOption(o: DashboardOptionRow): CostEngineOption {
  return {
    id: o.id,
    categoryId: o.categoryId,
    status: o.status as OptionStatus,
    amount: o.amount === null ? null : Number(o.amount),
    currency: o.currency,
    costType: o.costType as CostType,
    participationMode: o.participationMode as ParticipationMode,
    participantCount: o._count.participants,
    voteCount: o._count.votes,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * The engine result + the source rows + trip meta → the wire view. `lines`
 * breaks the totals down per contributing option: every `LOCKED` option (the
 * committed total) and every front-runner (projection-only), each enriched with
 * the title/category the engine doesn't carry.
 */
export function toTripDashboardView(
  trip: {
    id: string;
    defaultCurrency: string;
    /** Prisma `Decimal | null`; normalised to a number on the way out. */
    budgetPerPerson: { toString(): string } | null;
  },
  memberCount: number,
  rows: readonly DashboardOptionRow[],
  result: CostDashboard,
  generatedAt: Date,
  /** The day's rates, or null when there are none worth converting with. */
  rates: StoredRates | null = null,
): TripDashboardView {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const costById = new Map(result.options.map((c) => [c.optionId, c]));

  const lineFor = (
    optionId: string,
    kind: DashboardLineKind,
  ): DashboardLine | null => {
    const row = rowById.get(optionId);
    const cost = costById.get(optionId);
    if (!row || !cost) return null;
    return {
      optionId,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      title: row.title,
      kind,
      currency: cost.currency,
      group: cost.group,
      perPerson: cost.perPerson,
      effectiveHeadcount: cost.effectiveHeadcount,
      viewerOwes: viewerOwes(row),
      converted: convertedLine(cost, trip.defaultCurrency, rates),
    };
  };

  const lines: DashboardLine[] = [];
  for (const row of rows) {
    if (row.status === "LOCKED") {
      const line = lineFor(row.id, "LOCKED");
      if (line) lines.push(line);
    }
  }
  for (const id of result.frontRunnerOptionIds) {
    const line = lineFor(id, "FRONT_RUNNER");
    if (line) lines.push(line);
  }

  // The committed total narrowed to what this viewer actually pays for. Built
  // from the LOCKED lines alone, because that is what the target is read
  // against, and aggregated per currency so it can be converted the same way
  // every other total is.
  //
  // Unpriced lines are dropped, exactly as the engine drops them from
  // `committed` — this total is the same kind of claim and has to be filtered in
  // the same place, or the bug the engine fix closed simply reappears here. A
  // trip whose only decision was its dates has one locked line, unpriced, and
  // aggregating it named the trip's currency in a subtotal of nothing: the
  // figure the per-person verdict reads, saying money was committed when none
  // was. `DashboardLine` has no `amount` — a line priced at zero and an unpriced
  // one both carry `group: 0` — so the price comes from the source row.
  const viewerCommitted = aggregateShare(
    lines.filter(
      (l) =>
        l.kind === "LOCKED" &&
        l.viewerOwes &&
        rowById.get(l.optionId)?.amount !== null,
    ),
  );

  return {
    tripId: trip.id,
    defaultCurrency: trip.defaultCurrency,
    // The target the totals are read against. The engine knows nothing about
    // it — it is carried alongside the figures, never applied to them.
    budgetPerPerson:
      trip.budgetPerPerson === null ? null : Number(trip.budgetPerPerson),
    memberCount,
    committed: result.committed.map((s) => ({ ...s })),
    projected: result.projected.map((s) => ({ ...s })),
    viewerCommitted,
    lines,
    converted: convertedCost(
      trip.defaultCurrency,
      result,
      rates,
      viewerCommitted,
    ),
    generatedAt: generatedAt.toISOString(),
  };
}

/**
 * One line's money in the trip's own currency, or null when no rate reaches it.
 *
 * {@link convertSubtotals} deliberately converts *subtotals* rather than
 * options — one multiplication per currency rounds better than one per line —
 * and that stays the rule for every **total** on this payload. This is a
 * different job: a surface that draws the total broken into parts needs each
 * part in one unit, and the parts have to be converted individually for that to
 * exist at all.
 *
 * The consequence is that a set of converted lines can sum to a hair off the
 * converted total beside it. The totals remain the figures of record; a caller
 * drawing parts should draw them *proportionally* and take its headline from
 * the totals, never from re-adding these.
 *
 * A line already in the trip's currency crosses at 1 and comes back unchanged,
 * so a caller never has to special-case it. When the trip's own currency has no
 * published rate the aggregate {@link ConvertedCost} is null while those
 * identity lines survive — the same shape as the target verdict, which falls
 * back to the trip-currency figures alone and names what it left out.
 */
function convertedLine(
  cost: { group: number; perPerson: number; currency: string },
  defaultCurrency: string,
  rates: StoredRates | null,
): ConvertedLine | null {
  if (!rates) return null;
  const rate = crossRate(cost.currency, defaultCurrency, rates.rates);
  if (rate === null) return null;
  return { group: cost.group * rate, perPerson: cost.perPerson * rate };
}

/**
 * The same money, roughly, in the trip's own currency — or null.
 *
 * Added beside the exact per-currency subtotals, never instead of them: FR-27's
 * promise is that no *exact* total mixes currencies, and this is explicitly not
 * an exact total. It is null whenever it cannot be offered honestly — no rates
 * stored, rates too old to trust, or nothing published for the currency the
 * trip thinks in — and the surfaces fall back to the per-currency view, which
 * has never been wrong.
 *
 * A trip priced entirely in its own currency still gets one. The figures are
 * then identical to the subtotal, and that is the point: the surface does not
 * have to decide whether a conversion "counts", and `missing` stays empty.
 */
function convertedCost(
  defaultCurrency: string,
  result: CostDashboard,
  rates: StoredRates | null,
  viewerCommitted: readonly DashboardSubtotal[],
): ConvertedCost | null {
  if (!rates) return null;
  const committed = convertSubtotals(
    result.committed,
    defaultCurrency,
    rates.rates,
  );
  const projected = convertSubtotals(
    result.projected,
    defaultCurrency,
    rates.rates,
  );
  if (!committed || !projected) return null;
  // Converted from the viewer's own subtotals, never re-added from their lines:
  // one multiplication per currency rounds better than one per line, and that
  // is the rule every total on this payload follows.
  const crossed = convertSubtotals(
    viewerCommitted,
    defaultCurrency,
    rates.rates,
  );
  const viewer = crossed
    ? {
        group: crossed.group,
        perPerson: crossed.perPerson,
        converted: [...crossed.converted],
        missing: [...crossed.missing],
      }
    : null;

  return {
    currency: defaultCurrency,
    committed: { group: committed.group, perPerson: committed.perPerson },
    projected: { group: projected.group, perPerson: projected.perPerson },
    viewer,
    asOf: rates.asOf,
    // The projection is the superset — it is the committed options plus the
    // front-runners — so its currency lists are the ones that describe the
    // whole picture.
    converted: [...projected.converted],
    missing: [...projected.missing],
  };
}

/**
 * Sum a viewer's own lines into per-currency subtotals, sorted by currency.
 *
 * Both figures are real: `perPerson` is what this viewer owes, and `group` is
 * what the whole trip pays for that same set of options — not a restatement of
 * the first, and not the trip's total either, since the options this viewer
 * declined are absent from both.
 */
function aggregateShare(lines: readonly DashboardLine[]): DashboardSubtotal[] {
  const byCurrency = new Map<string, { group: number; perPerson: number }>();
  for (const l of lines) {
    const acc = byCurrency.get(l.currency) ?? { group: 0, perPerson: 0 };
    acc.group += l.group;
    acc.perPerson += l.perPerson;
    byCurrency.set(l.currency, acc);
  }
  return [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
