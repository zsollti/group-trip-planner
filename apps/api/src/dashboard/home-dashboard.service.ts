import { Injectable } from "@nestjs/common";
import type { Prisma, Trip } from "@prisma/client";
import {
  isTripFrozen,
  optionCost,
  resolveHeadcount,
  type CostType,
  type HomeDashboardView,
  type HomeTripCost,
  type HomeTripSummary,
  type TripStatus,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Effective status (decision 4): past-expiry reads as History pre-job. */
function effectiveStatus(trip: Trip): TripStatus {
  return isTripFrozen(trip.status, trip.expiresAt.toISOString())
    ? "HISTORY"
    : trip.status;
}

/** The minimal per-option fields the home summaries need. */
const summaryOptionSelect = {
  categoryId: true,
  status: true,
  amount: true,
  currency: true,
  costType: true,
  participationMode: true,
  // An OPT_IN option's headcount is this count, so it is selected for every
  // option rather than fetched per row.
  _count: { select: { participants: true } },
  category: { select: { tripId: true } },
} satisfies Prisma.OptionSelect;

type SummaryOption = Prisma.OptionGetPayload<{
  select: typeof summaryOptionSelect;
}>;

/**
 * All-trips home dashboard (Phase 3.4, SRS §6). Returns one offset-paginated page
 * of the caller's trips, each with a **per-currency committed cost summary** and
 * a **pending-decision count** (categories with a proposal but no locked option —
 * decision 3).
 *
 * **No N+1 across the list (NFR-1):** exactly three queries regardless of how
 * many trips or options the page holds — the trip count, the page of memberships
 * (+trip +member count), and a **single** options query scoped to the page's
 * trips. The per-trip figures are then aggregated in memory with the shared pure
 * cost primitives ({@link optionCost} / {@link resolveHeadcount}).
 */
@Injectable()
export class HomeDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getHomeDashboard(
    userId: string,
    limitRaw?: number,
    offsetRaw?: number,
  ): Promise<HomeDashboardView> {
    const limit = Math.min(Math.max(1, limitRaw ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, offsetRaw ?? 0);

    const [total, memberships] = await Promise.all([
      this.prisma.tripMembership.count({ where: { userId } }),
      this.prisma.tripMembership.findMany({
        where: { userId },
        include: {
          trip: { include: { _count: { select: { memberships: true } } } },
        },
        // The member's own arrangement first, then newest-first for everything
        // they have never dragged. `nulls: "last"` is the whole trick: without
        // it Postgres sorts NULLs first ascending, so arranging one tile would
        // bury it under every trip that had never been touched.
        orderBy: [
          { sortOrder: { sort: "asc", nulls: "last" } },
          { trip: { createdAt: "desc" } },
        ],
        skip: offset,
        take: limit,
      }),
    ]);

    const tripIds = memberships.map((m) => m.tripId);

    // One query for every option that feeds the page's summaries.
    const options: SummaryOption[] =
      tripIds.length === 0
        ? []
        : await this.prisma.option.findMany({
            where: { deletedAt: null, category: { tripId: { in: tripIds } } },
            select: summaryOptionSelect,
          });

    const byTrip = new Map<string, SummaryOption[]>();
    for (const o of options) {
      const list = byTrip.get(o.category.tripId) ?? [];
      list.push(o);
      byTrip.set(o.category.tripId, list);
    }

    const trips: HomeTripSummary[] = memberships.map((m) => {
      const trip = m.trip;
      const memberCount = trip._count.memberships;
      const { cost, pendingDecisionCount } = summarize(
        byTrip.get(trip.id) ?? [],
        memberCount,
      );
      return {
        id: trip.id,
        name: trip.name,
        destination: trip.destination,
        startDate: iso(trip.startDate),
        endDate: iso(trip.endDate),
        status: effectiveStatus(trip),
        role: m.role,
        memberCount,
        defaultCurrency: trip.defaultCurrency,
        cost,
        pendingDecisionCount,
        createdAt: trip.createdAt.toISOString(),
      };
    });

    return { trips, total, limit, offset };
  }

  /**
   * Store the caller's own arrangement of their overview.
   *
   * One `updateMany` per trip, all in one transaction, so the page never reads
   * a half-applied order. The `where` carries **both** the trip id and the
   * caller's `userId`: that is what makes this incapable of touching anyone
   * else's row, and it is also why an id the caller is not a member of simply
   * matches nothing instead of needing a membership check of its own — a stale
   * id from a trip deleted in another tab is not an error worth failing the
   * whole drag over.
   *
   * The indices are the positions as given, so the numbers stay dense and a
   * later insert never has to renumber around a gap.
   */
  async reorderTrips(userId: string, tripIds: readonly string[]): Promise<void> {
    if (tripIds.length === 0) return;
    await this.prisma.$transaction(
      tripIds.map((tripId, index) =>
        this.prisma.tripMembership.updateMany({
          where: { tripId, userId },
          data: { sortOrder: index },
        }),
      ),
    );
  }
}

/**
 * A trip's home figures from its loaded options (pure): the committed group total
 * per currency (locked options only, headcount-resolved via the shared engine)
 * and the count of still-open categories (≥1 proposed, no locked — decision 3).
 */
function summarize(
  options: readonly SummaryOption[],
  memberCount: number,
): { cost: HomeTripCost[]; pendingDecisionCount: number } {
  const byCurrency = new Map<string, number>();
  const categories = new Map<string, { proposed: boolean; locked: boolean }>();

  for (const o of options) {
    const cat = categories.get(o.categoryId) ?? {
      proposed: false,
      locked: false,
    };
    if (o.status === "LOCKED") {
      cat.locked = true;
      const headcount = resolveHeadcount(
        {
          participationMode: o.participationMode,
          participantCount: o._count.participants,
        },
        memberCount,
      );
      const { group } = optionCost(
        o.amount === null ? null : Number(o.amount),
        o.costType as CostType,
        headcount,
      );
      byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + group);
    } else {
      cat.proposed = true;
    }
    categories.set(o.categoryId, cat);
  }

  let pendingDecisionCount = 0;
  for (const cat of categories.values()) {
    if (cat.proposed && !cat.locked) pendingDecisionCount += 1;
  }

  const cost = [...byCurrency.entries()]
    .map(([currency, committed]) => ({ currency, committed }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { cost, pendingDecisionCount };
}
