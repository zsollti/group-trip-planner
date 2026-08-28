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
  type PersonalDashboardLine,
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
export const dashboardOptionInclude = () =>
  ({
    category: { select: { id: true, name: true } },
    // Counted in the same statement as the votes, never per row: an OPT_IN
    // option's headcount *is* this number, so the engine needs it for every
    // option it prices.
    _count: { select: { votes: true, participants: true } },
    // **The whole list, not just the viewer's row.** It used to be filtered to
    // the caller, because all anyone asked of it was "do I pay for this?". The
    // cost surface now draws the people an opt-in option is priced for as
    // faces, and a face needs a name and a picture. Still one statement and one
    // join — the same reasoning `optionInclude` records for voters: a round
    // trip per person to fetch a column the list is about to render would be an
    // N+1 for one nullable field.
    participants: {
      orderBy: { createdAt: "asc" },
      select: {
        userId: true,
        createdAt: true,
        user: { select: { displayName: true, avatarUrl: true } },
      },
    },
  }) as const;

export type DashboardOptionRow = Option & {
  category: { id: string; name: string };
  _count: { votes: number; participants: number };
  /** Everyone who opted in, earliest first. Empty for a whole-group option. */
  participants: {
    userId: string;
    createdAt: Date;
    user: { displayName: string; avatarUrl: string | null };
  }[];
};

/**
 * Does this viewer pay for this option?
 *
 * Whole-group options are everyone's; an opt-in option is only the people who
 * said so.
 *
 * **Asked by id.** This used to read `participants.length > 0`, which was true
 * only because the include was filtered to the caller — the list's *emptiness*
 * was carrying the answer. Widening that include to draw the faces would have
 * made every opt-in option look like the viewer's the moment anyone joined it,
 * and the per-person total would have charged them for things they declined.
 * The question is now asked directly, so the include can hold whatever it needs
 * to.
 */
function viewerOwes(row: DashboardOptionRow, viewerId: string): boolean {
  return (
    row.participationMode !== "OPT_IN" ||
    row.participants.some((p) => p.userId === viewerId)
  );
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
/**
 * A stored personal item, as the mapper needs it: the row plus its tag's name.
 *
 * The name rides along on the include rather than being looked up per line —
 * the same reasoning as the option rows' `category.name`.
 */
export type DashboardPersonalRow = {
  id: string;
  title: string;
  currency: string;
  amount: { toString(): string } | null;
  categoryId: string | null;
  category: { name: string } | null;
};

/** The Prisma include that hydrates {@link DashboardPersonalRow}. */
export const dashboardPersonalInclude = {
  category: { select: { name: true } },
} as const;

export function toTripDashboardView(
  trip: {
    id: string;
    defaultCurrency: string;
    /** Prisma `Decimal | null`; normalised to a number on the way out. */
    budgetPerPerson: { toString(): string } | null;
  },
  memberCount: number,
  /** Whose dashboard this is — `viewerOwes` and nothing else reads it. */
  viewerId: string,
  rows: readonly DashboardOptionRow[],
  result: CostDashboard,
  generatedAt: Date,
  /** The day's rates, or null when there are none worth converting with. */
  rates: StoredRates | null = null,
  /** The caller's **own** private items. Never anybody else's — the service
   *  queries them scoped to this viewer, and there is no other way in. */
  personalRows: readonly DashboardPersonalRow[] = [],
  /**
   * The caller's **own** spending limit, or null when they have not set one.
   *
   * A parameter rather than a field on `trip`, because it is not the trip's: it
   * is read off the caller's membership, and putting it beside
   * `trip.budgetPerPerson` here is the one place the two could be confused for
   * one number. Prisma `Decimal | null`, normalised on the way out like the
   * trip's own.
   */
  viewerBudget: { toString(): string } | null = null,
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
      // Empty for a whole-group option, and not by a branch here: nobody has a
      // participation row on one, so the list is naturally the trip's answer to
      // "who specifically" — which for everyone is no one in particular.
      participants: row.participants.map((p) => ({
        userId: p.userId,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        joinedAt: p.createdAt.toISOString(),
      })),
      viewerOwes: viewerOwes(row, viewerId),
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

  /*
   * The caller's own private spend.
   *
   * Unpriced items are dropped rather than zeroed, for the reason the engine
   * drops unpriced options: a currency in a subtotal is a claim that money is
   * committed in it, and an item someone noted without a price has committed
   * none. Zeroing it would name the trip's currency in a subtotal of nothing —
   * the exact shape of the phantom EUR total that reached the board once
   * already.
   */
  const personalLines: PersonalDashboardLine[] = personalRows
    .filter((r) => r.amount !== null)
    .map((r) => {
      const amount = Number(r.amount);
      return {
        itemId: r.id,
        categoryId: r.categoryId,
        categoryName: r.category?.name ?? null,
        title: r.title,
        currency: r.currency,
        amount,
        converted: convertedAmount(
          amount,
          r.currency,
          trip.defaultCurrency,
          rates,
        ),
      };
    });

  // `group` and `perPerson` are the same figure: the group paying for one of
  // these is one person. Held in the shared subtotal shape so it crosses
  // currencies through the same path as every other total on this payload.
  const viewerPersonal = aggregateShare(
    personalLines.map((l) => ({
      currency: l.currency,
      group: l.amount,
      perPerson: l.amount,
    })),
  );

  return {
    tripId: trip.id,
    defaultCurrency: trip.defaultCurrency,
    // The target the totals are read against. The engine knows nothing about
    // it — it is carried alongside the figures, never applied to them.
    budgetPerPerson:
      trip.budgetPerPerson === null ? null : Number(trip.budgetPerPerson),
    // The caller's own limit, and the only target their private spending may be
    // read against. Beside the trip's, never folded into it.
    viewerBudget: viewerBudget === null ? null : Number(viewerBudget),
    memberCount,
    committed: result.committed.map((s) => ({ ...s })),
    projected: result.projected.map((s) => ({ ...s })),
    viewerCommitted,
    viewerPersonal,
    lines,
    personalLines,
    converted: convertedCost(
      trip.defaultCurrency,
      result,
      rates,
      viewerCommitted,
      viewerPersonal,
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
/**
 * One amount in the trip's own currency, or null when no rate reaches it.
 *
 * {@link convertedLine}'s single-figure sibling, for the rows that have one
 * number rather than a group/per-head pair.
 */
function convertedAmount(
  amount: number,
  from: string,
  to: string,
  rates: StoredRates | null,
): number | null {
  if (!rates) return null;
  const rate = crossRate(from, to, rates.rates);
  return rate === null ? null : amount * rate;
}

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
  viewerPersonal: readonly DashboardSubtotal[],
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

  // The reader's own private spend, crossed the same way — and kept in its own
  // field, because it is the one figure here that must never reach the target.
  const ownCrossed = convertSubtotals(
    viewerPersonal,
    defaultCurrency,
    rates.rates,
  );
  const personal = ownCrossed
    ? {
        amount: ownCrossed.group,
        converted: [...ownCrossed.converted],
        missing: [...ownCrossed.missing],
      }
    : null;

  return {
    currency: defaultCurrency,
    committed: { group: committed.group, perPerson: committed.perPerson },
    projected: { group: projected.group, perPerson: projected.perPerson },
    viewer,
    personal,
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
function aggregateShare(
  // The three fields it actually reads, rather than a whole `DashboardLine`.
  // A personal item's subtotal is the same arithmetic over rows that have no
  // kind, no headcount and nobody who opted in, and narrowing the parameter to
  // what the body touches is what lets one definition serve both.
  lines: readonly { currency: string; group: number; perPerson: number }[],
): DashboardSubtotal[] {
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
