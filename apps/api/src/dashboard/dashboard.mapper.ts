import type { Option } from "@prisma/client";
import {
  convertSubtotals,
  type ConvertedCost,
  type CostDashboard,
  type CostEngineOption,
  type CostType,
  type DashboardLine,
  type DashboardLineKind,
  type OptionStatus,
  type TripDashboardView,
} from "@gtp/types";
import type { StoredRates } from "../rates/rates.service.js";

/**
 * The Prisma include that hydrates everything the dashboard needs in **one**
 * query (NFR-1, no N+1): each option's category name and its vote tally (via a
 * relation `_count`, resolved in the same SQL statement — never per row).
 */
export const dashboardOptionInclude = {
  category: { select: { id: true, name: true } },
  _count: { select: { votes: true } },
} as const;

export type DashboardOptionRow = Option & {
  category: { id: string; name: string };
  _count: { votes: number };
};

/** A stored option row → the lean shape the pure cost engine consumes. */
export function toEngineOption(o: DashboardOptionRow): CostEngineOption {
  return {
    id: o.id,
    categoryId: o.categoryId,
    status: o.status as OptionStatus,
    amount: o.amount === null ? null : Number(o.amount),
    currency: o.currency,
    costType: o.costType as CostType,
    headcount: o.headcount,
    headcountIsFixed: o.headcountIsFixed,
    voteCount: o._count.votes,
    headcountConfirmedAt: o.headcountConfirmedAt
      ? o.headcountConfirmedAt.toISOString()
      : null,
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
      headcountStale: cost.headcountStale,
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
    lines,
    hasStaleHeadcount: result.hasStaleHeadcount,
    converted: convertedCost(trip.defaultCurrency, result, rates),
    generatedAt: generatedAt.toISOString(),
  };
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

  return {
    currency: defaultCurrency,
    committed: { group: committed.group, perPerson: committed.perPerson },
    projected: { group: projected.group, perPerson: projected.perPerson },
    asOf: rates.asOf,
    // The projection is the superset — it is the committed options plus the
    // front-runners — so its currency lists are the ones that describe the
    // whole picture.
    converted: [...projected.converted],
    missing: [...projected.missing],
  };
}
