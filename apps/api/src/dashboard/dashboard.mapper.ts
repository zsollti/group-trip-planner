import type { Option } from "@prisma/client";
import {
  type CostDashboard,
  type CostEngineOption,
  type CostType,
  type DashboardLine,
  type DashboardLineKind,
  type OptionStatus,
  type TripDashboardView,
} from "@gtp/types";

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
    generatedAt: generatedAt.toISOString(),
  };
}
