import type { CostType, OptionStatus } from "./options.js";

/**
 * Cost engine (Phase 3.1, SRS §13 / FR-26–27) — the pure, framework-free core
 * that turns Phase-2 options into a per-currency cost picture. **No Prisma, no
 * Nest, no clock**: every input is passed in, so this is the app's headline
 * unit-test suite and could be lifted wholesale into a future mobile client
 * (decision 4). The Phase-3.2 `GET /trips/:id/dashboard` endpoint is a thin
 * adapter that maps DB rows to {@link CostEngineOption} and formats the result.
 *
 * Four rules live here as the single source of truth:
 *  - **Option cost** ({@link optionCost}) — `PER_PERSON`: group = `amount ×
 *    headcount`, per-head = `amount`; `TOTAL`: group = `amount`, per-head =
 *    `amount ÷ headcount` (FR-26).
 *  - **Headcount resolution** — a **dynamic** option uses the trip's current
 *    member count; a **fixed** option uses its stored `headcount`, never
 *    recalculated (FR-26).
 *  - **Aggregation** — group and per-person subtotals **per currency, never
 *    summed across currencies** (no conversion, FR-27). Per-person is the sum of
 *    each option's own per-head cost, so trips that mix fixed and dynamic
 *    headcounts still add up correctly.
 *  - **Committed vs. projected** (decision 1) — committed = the exact total of
 *    locked options; projected = committed **plus the front-runner** (top-voted
 *    proposed option) of each still-open category ("if the current front-runners
 *    win").
 *
 * The stale-headcount predicate ({@link isHeadcountStale}, decision 2) mirrors
 * the Phase-2 vote-staleness rule: a fixed-headcount option is stale once trip
 * membership has changed since the headcount was confirmed.
 *
 * Money is kept as raw `number`s here — rounding and currency formatting are the
 * front-end's job, so no minor-unit assumptions leak into the shared contract.
 */

/** The minimal shape the engine needs from an option — the adapter maps rows to this. */
export interface CostEngineOption {
  readonly id: string;
  /** Which category the option belongs to (front-runner is picked per category). */
  readonly categoryId: string;
  /** `PROPOSED` options feed the projection; `LOCKED` ones feed the committed total. */
  readonly status: OptionStatus;
  /** Price; `null` (unpriced) contributes zero to every total. */
  readonly amount: number | null;
  /** 3-letter currency code — the aggregation key (never converted). */
  readonly currency: string;
  readonly costType: CostType;
  /** Stored headcount; used only when `headcountIsFixed` (else the live count wins). */
  readonly headcount: number | null;
  readonly headcountIsFixed: boolean;
  /** Approval tally — decides the per-category front-runner for the projection. */
  readonly voteCount: number;
  /** When the fixed headcount was confirmed; drives {@link isHeadcountStale}. */
  readonly headcountConfirmedAt: string | null;
  /** Proposal time — the deterministic front-runner tiebreaker (earliest wins). */
  readonly createdAt: string;
}

/** A group + per-person money pair for one currency (FR-27, no conversion). */
export interface CurrencySubtotal {
  readonly currency: string;
  readonly group: number;
  readonly perPerson: number;
}

/** The computed cost of a single option, plus its resolved headcount and stale flag. */
export interface OptionCost {
  readonly optionId: string;
  readonly currency: string;
  readonly group: number;
  readonly perPerson: number;
  /** The headcount actually used (fixed value, or the live member count). */
  readonly effectiveHeadcount: number;
  /** True iff a fixed headcount predates a later membership change (decision 2). */
  readonly headcountStale: boolean;
}

/** The full per-trip cost picture returned by {@link computeCostDashboard}. */
export interface CostDashboard {
  /** Exact per-currency totals of the locked decisions, sorted by currency. */
  readonly committed: readonly CurrencySubtotal[];
  /** Committed **plus** each open category's front-runner, sorted by currency. */
  readonly projected: readonly CurrencySubtotal[];
  /** Per-option cost for **every** input option, so any card can show its figure. */
  readonly options: readonly OptionCost[];
  /** The proposed options selected into the projection (one per open category). */
  readonly frontRunnerOptionIds: readonly string[];
  /** True iff any option that feeds the totals has a stale fixed headcount. */
  readonly hasStaleHeadcount: boolean;
}

/**
 * Is a fixed headcount out of date? Pure and total, mirroring `isVoteStale`
 * (Phase 2.3): a **dynamic** option is never stale (it always reflects the live
 * count); a **fixed** option is stale once membership changed after the count was
 * confirmed — i.e. `headcountConfirmedAt` is strictly before `membershipChangedAt`
 * (decision 2). A fixed option whose confirmation time is unknown is treated as
 * stale once any membership change is recorded, so the warning surfaces rather
 * than hides.
 */
export function isHeadcountStale(
  headcountIsFixed: boolean,
  headcountConfirmedAt: string | null,
  membershipChangedAt: string | null,
): boolean {
  if (!headcountIsFixed) return false;
  if (membershipChangedAt === null) return false;
  if (headcountConfirmedAt === null) return true;
  return (
    new Date(headcountConfirmedAt).getTime() <
    new Date(membershipChangedAt).getTime()
  );
}

/**
 * Resolve the headcount an option is priced against: the stored value for a fixed
 * option, otherwise the trip's current member count. A fixed option missing its
 * number falls back to the live count (the create schema forbids this, but the
 * engine stays total).
 */
export function resolveHeadcount(
  option: Pick<CostEngineOption, "headcountIsFixed" | "headcount">,
  currentMemberCount: number,
): number {
  if (option.headcountIsFixed && option.headcount !== null) {
    return option.headcount;
  }
  return currentMemberCount;
}

/**
 * The group and per-person cost of one option (FR-26). `PER_PERSON` prices each
 * head, so the group scales with headcount; `TOTAL` prices the whole thing, so
 * the per-head share is the amount divided by heads. An unpriced option costs
 * zero; a zero headcount yields a zero per-head share rather than a division by
 * zero.
 */
export function optionCost(
  amount: number | null,
  costType: CostType,
  headcount: number,
): { group: number; perPerson: number } {
  if (amount === null) return { group: 0, perPerson: 0 };
  if (costType === "PER_PERSON") {
    return { group: amount * headcount, perPerson: amount };
  }
  // TOTAL
  return {
    group: amount,
    perPerson: headcount > 0 ? amount / headcount : 0,
  };
}

/** Sum a set of option costs into per-currency subtotals, sorted by currency. */
function aggregateByCurrency(
  costs: readonly OptionCost[],
): CurrencySubtotal[] {
  const byCurrency = new Map<string, { group: number; perPerson: number }>();
  for (const c of costs) {
    const acc = byCurrency.get(c.currency) ?? { group: 0, perPerson: 0 };
    acc.group += c.group;
    acc.perPerson += c.perPerson;
    byCurrency.set(c.currency, acc);
  }
  return [...byCurrency.entries()]
    .map(([currency, { group, perPerson }]) => ({ currency, group, perPerson }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Pick the front-runner among an open category's proposed options: the highest
 * `voteCount`, ties broken by the earliest `createdAt`, then by `id` for full
 * determinism. Returns `undefined` for an empty list.
 */
function pickFrontRunner(
  proposed: readonly CostEngineOption[],
): CostEngineOption | undefined {
  if (proposed.length === 0) return undefined;
  return [...proposed].sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Compute the whole per-trip cost picture (FR-26/27, decisions 1–2). Pure — the
 * live member count and the trip's `membershipChangedAt` are injected, so every
 * branch is unit-testable without a DB or a clock.
 *
 * The **committed** total sums every `LOCKED` option (a multi-select category can
 * contribute several). The **projection** adds, for each category with no locked
 * option, that category's front-runner ({@link pickFrontRunner}). Both are broken
 * out per currency and never summed across currencies.
 */
export function computeCostDashboard(
  options: readonly CostEngineOption[],
  currentMemberCount: number,
  membershipChangedAt: string | null,
): CostDashboard {
  // Per-option cost for every input option (the UI can look up any card).
  const costs: OptionCost[] = options.map((o) => {
    const effectiveHeadcount = resolveHeadcount(o, currentMemberCount);
    const { group, perPerson } = optionCost(
      o.amount,
      o.costType,
      effectiveHeadcount,
    );
    return {
      optionId: o.id,
      currency: o.currency,
      group,
      perPerson,
      effectiveHeadcount,
      headcountStale: isHeadcountStale(
        o.headcountIsFixed,
        o.headcountConfirmedAt,
        membershipChangedAt,
      ),
    };
  });
  const costById = new Map(costs.map((c) => [c.optionId, c] as const));

  const locked = options.filter((o) => o.status === "LOCKED");
  const lockedCategoryIds = new Set(locked.map((o) => o.categoryId));

  // One front-runner per still-open category (no locked option in it).
  const proposedByCategory = new Map<string, CostEngineOption[]>();
  for (const o of options) {
    if (o.status !== "PROPOSED") continue;
    if (lockedCategoryIds.has(o.categoryId)) continue;
    const list = proposedByCategory.get(o.categoryId) ?? [];
    list.push(o);
    proposedByCategory.set(o.categoryId, list);
  }
  const frontRunners: CostEngineOption[] = [];
  for (const proposed of proposedByCategory.values()) {
    const winner = pickFrontRunner(proposed);
    if (winner) frontRunners.push(winner);
  }

  const lockedCosts = locked
    .map((o) => costById.get(o.id))
    .filter((c): c is OptionCost => c !== undefined);
  const frontRunnerCosts = frontRunners
    .map((o) => costById.get(o.id))
    .filter((c): c is OptionCost => c !== undefined);

  const committed = aggregateByCurrency(lockedCosts);
  const projected = aggregateByCurrency([...lockedCosts, ...frontRunnerCosts]);

  // Only options that actually feed the totals can raise the trip-level warning.
  const hasStaleHeadcount = [...lockedCosts, ...frontRunnerCosts].some(
    (c) => c.headcountStale,
  );

  return {
    committed,
    projected,
    options: costs,
    frontRunnerOptionIds: frontRunners.map((o) => o.id),
    hasStaleHeadcount,
  };
}
