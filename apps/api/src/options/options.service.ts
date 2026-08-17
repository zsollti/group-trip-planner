import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import {
  canManageOption,
  fallbackExpiresAt,
  hasMaterialChange,
  isTripFrozen,
  maxTripHorizonDays,
  OPTIONS_CHANGED_EVENT,
  planLockedDates,
  type CreateOptionInput,
  type LockDatesRejection,
  type LockOptionInput,
  type OptionsChanged,
  type OptionsChangedKind,
  type OptionView,
  type ReorderOptionsInput,
  type UnlockOptionInput,
  type UpdateOptionInput,
} from "@gtp/types";
import { optionAudit } from "../activity/audit.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import type { TripContext } from "../trips/trip-context.js";
import {
  optionInclude,
  toMaterialSnapshot,
  toOptionView,
} from "./option.mapper.js";

/**
 * Title for the Dates option seeded from the create form. Deliberately not the
 * date range itself — the card renders `startsAt`/`endsAt` in the reader's own
 * locale right beneath the title, and a title that restated them would be both
 * duplicated and formatted server-side in someone else's conventions.
 */
const SEEDED_DATES_TITLE = "Trip dates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Options within a category (Phase 2.2, SRS §6 / FR-21–23). The route guards
 * resolve the trip + caller role (404 for non-members) and enforce the coarse
 * `option.propose` capability (Participant+, not Guest); this service owns the
 * data rules — the category/trip scoping, the Active-trip freeze, the
 * proposer-or-Organizer edit rule (`canManageOption`), the locked-option guard,
 * optimistic concurrency, the material-edit stale-vote stamp, and soft delete.
 */
@Injectable()
export class OptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Seed a brand-new trip's Dates decision as an **already-locked option**, when
   * the creator supplied dates on the create form (post-launch).
   *
   * Called inside the trip-creation transaction, so a trip whose columns say it
   * runs 3–10 August can never exist without the locked option those columns
   * were derived from. The caller has already validated the dates with
   * `planLockedDates` and written `startDate`/`endDate`/`expiresAt` from its
   * result — this writes the option that justifies them.
   *
   * Why an option rather than just the columns: the trip's dates have exactly
   * one writer, the Dates lock. Setting the columns directly would make create a
   * second writer, and the board would show an empty Dates lane above a trip
   * that clearly has dates — with unlocking, the ordinary way to reopen the
   * question, having nothing to unlock. Seeded this way, every later path
   * (unlock, propose an alternative, re-lock) already works.
   *
   * Audited as an ordinary `OPTION_LOCKED` by the creator, because that is what
   * it is; the activity feed should not have a hole where the trip's dates came
   * from.
   */
  static async seedLockedDates(
    tx: Prisma.TransactionClient,
    tripId: string,
    ownerId: string,
    dates: { startDate: Date; endDate: Date },
    tripCurrency: string,
  ): Promise<void> {
    // The `@@unique([tripId, builtinKey])` row seeded moments ago in this same
    // transaction.
    const category = await tx.category.findFirstOrThrow({
      where: { tripId, builtinKey: "DATES" },
      select: { id: true },
    });
    const option = await tx.option.create({
      data: {
        categoryId: category.id,
        proposerId: ownerId,
        title: SEEDED_DATES_TITLE,
        // The trip's own currency, even though this option is unpriced and
        // always will be — `categoryOptionFields` hides the cost fields on the
        // Dates category, so nothing can ever put an amount here.
        //
        // It was hardcoded `"EUR"` on the reasoning that an unpriced option
        // costs nothing, so the code was arbitrary. It was not: the cost engine
        // aggregated every locked option by currency regardless of price, so a
        // dollar trip whose only decision was its dates reported a zero **EUR**
        // subtotal, and the board drew a total and a chart for it. That is fixed
        // at the root in `computeCostDashboard` (unpriced options no longer
        // reach the aggregation), and this stops the wrong code being stored in
        // the first place — a currency on a row is a fact about the trip, and it
        // should be a true one whether or not anything currently reads it.
        currency: tripCurrency,
        startsAt: dates.startDate,
        endsAt: dates.endDate,
        status: "LOCKED",
        lockedById: ownerId,
        lockedAt: new Date(),
      },
      select: { id: true, title: true },
    });
    await tx.auditEvent.create({
      data: auditData(tripId, ownerId, "OPTION_LOCKED", option.id, {
        optionTitle: option.title,
      }),
    });
  }

  /**
   * Push a "this lane changed" signal to everyone viewing the trip (Phase 4.5
   * retrofit, FR-29). Called after a committed propose/edit/delete/lock/unlock/
   * vote/reorder; clients refetch the affected lane and the cost dashboard, so a
   * locked decision and newly-proposed cards appear without a manual refresh. The
   * emit is null-safe (no-op when no socket server is attached), so it never
   * affects the pure/e2e option tests.
   *
   * `kind` tells the listener how far to look — see {@link OptionsChangedKind}.
   * It defaults to `option` because that is what almost every caller here is;
   * the two that reach further (lock and unlock) say so explicitly, and getting
   * that wrong is the one way this can under-refresh, so they are the sites to
   * check if a decision ever stops propagating.
   */
  private emitOptionsChanged(
    tripId: string,
    categoryId: string,
    kind: OptionsChangedKind = "option",
  ): void {
    const payload: OptionsChanged = { tripId, categoryId, kind };
    this.realtime.emitToTrip(tripId, OPTIONS_CHANGED_EVENT, payload);
  }

  /**
   * Reject any planning mutation (propose/edit/delete/vote/lock) on a frozen
   * trip (FR-10). Frozen = persisted History **or** past `expiresAt` — the
   * defensive read-time check (decision 4), so a not-yet-run expiry job can never
   * let a stale trip accept a write.
   */
  private assertActive(ctx: TripContext): void {
    if (isTripFrozen(ctx.trip.status, ctx.trip.expiresAt.toISOString())) {
      throw new ForbiddenException(
        "This trip has ended and can no longer be changed.",
      );
    }
  }

  /** A category scoped to this trip. Malformed id or wrong-trip category → 404. */
  private async requireCategory(ctx: TripContext, categoryId: string) {
    if (!UUID_RE.test(categoryId)) {
      throw new NotFoundException("Category not found");
    }
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, tripId: ctx.trip.id },
    });
    if (!category) throw new NotFoundException("Category not found");
    return category;
  }

  /** A live (non-deleted) option scoped to a category of this trip, else 404. */
  private async requireOption(categoryId: string, optionId: string) {
    if (!UUID_RE.test(optionId)) {
      throw new NotFoundException("Option not found");
    }
    const option = await this.prisma.option.findFirst({
      where: { id: optionId, categoryId, deletedAt: null },
    });
    if (!option) throw new NotFoundException("Option not found");
    return option;
  }

  /**
   * Live options in a category (newest last), any member (`trip.view`). Each
   * option carries its **public** approval tally + voter list (FR-22); the
   * viewer's own vote state (`viewerHasVoted`) is resolved against `viewerId`.
   */
  async listOptions(
    ctx: TripContext,
    viewerId: string,
    categoryId: string,
  ): Promise<OptionView[]> {
    await this.requireCategory(ctx, categoryId);
    const options = await this.prisma.option.findMany({
      where: { categoryId, deletedAt: null },
      include: optionInclude,
      // Manual order first (Phase 3.5 reorder), `createdAt` as a stable tiebreak
      // for options that share a position (e.g. before a first reorder).
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return options.map((o) =>
      toOptionView(o, viewerId, ctx.trip._count.memberships),
    );
  }

  /** Build the Prisma write payload for the option body (create/edit share it). */
  private toData(
    input: CreateOptionInput,
  ): Omit<Prisma.OptionUncheckedCreateInput, "categoryId" | "proposerId"> {
    return {
      title: input.title,
      description: input.description ?? null,
      url: input.url ?? null,
      amount: input.amount ?? null,
      currency: input.currency,
      costType: input.costType,
      participationMode: input.participationMode,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      externalRef: input.externalRef ?? null,
    };
  }

  /**
   * Propose an option (Participant+; the guard already excluded Guest, and
   * proposing is allowed unverified). Active-trip gated.
   */
  async proposeOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    input: CreateOptionInput,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);

    // Append at the end of the category's current order (Phase 3.5). Soft-deleted
    // rows keep their slot, so max-position+1 never collides with a live option.
    const last = await this.prisma.option.aggregate({
      where: { categoryId },
      _max: { position: true },
    });
    const nextPosition = (last._max.position ?? -1) + 1;

    const created = await this.prisma.option.create({
      data: {
        ...this.toData(input),
        categoryId,
        proposerId: user.id,
        position: nextPosition,
      },
      include: optionInclude,
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    // Tell the rest of the trip something new is on the table (Phase 5.1). After
    // the write, and best-effort inside the service — a proposal stands whether
    // or not its notifications land.
    await this.notifications.notify({
      tripId: ctx.trip.id,
      tripName: ctx.trip.name,
      actorId: user.id,
      actorName: user.displayName,
      type: "OPTION_PROPOSED",
      subject: created.title,
      categoryId,
    });
    return toOptionView(created, user.id, ctx.trip._count.memberships);
  }

  /**
   * Edit an option. Rules, in order: Active-trip; option exists (404); the
   * proposer-or-Organizer rule (`canManageOption` → 403); a **locked** option is
   * rejected until unlocked (409, FR-24); optimistic concurrency on `version`
   * (409); and a **material** change (cost/date field) stamps `materialChangedAt`
   * so prior votes are flagged stale without being deleted (FR-23).
   */
  async editOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
    input: UpdateOptionInput,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    if (!canManageOption(ctx.role, option.proposerId === user.id)) {
      throw new ForbiddenException(
        "Only the proposer or an organizer can edit this option.",
      );
    }
    if (option.status === "LOCKED") {
      throw new ConflictException(
        "This option is locked. Unlock it before editing.",
      );
    }

    // Compare cost/date fields before vs. after. Dates are canonicalised to UTC
    // so re-saving the same instant in a different string form isn't "material".
    const normDate = (s?: string): string | null =>
      s ? new Date(s).toISOString() : null;
    const material = hasMaterialChange(toMaterialSnapshot(option), {
      amount: input.amount ?? null,
      currency: input.currency,
      costType: input.costType,
      participationMode: input.participationMode,
      startsAt: normDate(input.startsAt),
      endsAt: normDate(input.endsAt),
    });

    const result = await this.prisma.option.updateMany({
      where: { id: option.id, version: input.version },
      data: {
        ...this.toData(input),
        version: { increment: 1 },
        ...(material ? { materialChangedAt: new Date() } : {}),
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "This option was changed since you opened it. Reload to see the latest.",
      );
    }

    const updated = await this.prisma.option.findUniqueOrThrow({
      where: { id: option.id },
      include: optionInclude,
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return toOptionView(updated, user.id, ctx.trip._count.memberships);
  }

  /**
   * Soft-delete an option (proposer or Organizer). Sets `deletedAt` so votes and
   * audit history survive (SRS §6). Active-trip gated.
   */
  async deleteOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
  ): Promise<void> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    if (!canManageOption(ctx.role, option.proposerId === user.id)) {
      throw new ForbiddenException(
        "Only the proposer or an organizer can delete this option.",
      );
    }
    await this.prisma.option.update({
      where: { id: option.id },
      data: { deletedAt: new Date() },
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
  }

  /**
   * Reorder a category's live options (Organizers, Phase 3.5 — the board's
   * drag-to-reorder gesture). Mirrors {@link CategoriesService.reorderCategories}:
   * the caller sends the **full** set of the category's live option ids in the
   * desired order; anything else (a missing/unknown id, a duplicate, a soft-deleted
   * id, a wrong count) is a 400, which keeps `position` gap-free and makes the write
   * idempotent. Positions are reassigned by index in one transaction. Reordering is
   * display-only — it touches no vote, cost, or lock state, so no `version` bump.
   */
  async reorderOptions(
    ctx: TripContext,
    user: User,
    categoryId: string,
    input: ReorderOptionsInput,
  ): Promise<OptionView[]> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);

    const current = await this.prisma.option.findMany({
      where: { categoryId, deletedAt: null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((o) => o.id));
    const requested = input.orderedIds;
    const requestedSet = new Set(requested);

    const isFullPermutation =
      requested.length === current.length &&
      requestedSet.size === requested.length &&
      requested.every((id) => currentIds.has(id));
    if (!isFullPermutation) {
      throw new BadRequestException(
        "Reorder must list each of the category's options exactly once.",
      );
    }

    await this.prisma.$transaction(
      requested.map((id, index) =>
        this.prisma.option.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return this.listOptions(ctx, user.id, categoryId);
  }

  /**
   * Cast an approval vote (Phase 2.3, FR-22). The route guard already restricted
   * this to `vote.cast` (Participant+, not Guest/Visitor). Idempotent: a repeat
   * vote is a no-op via the `[optionId, userId]` unique constraint. Voting is
   * advisory — it is allowed on a locked option (it never changes the decision)
   * but frozen on a History trip. Returns the option with its refreshed public
   * tally.
   */
  async castVote(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    await this.prisma.vote.upsert({
      where: { optionId_userId: { optionId: option.id, userId: user.id } },
      create: { optionId: option.id, userId: user.id },
      update: {},
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /**
   * Retract a vote (Phase 2.3). Idempotent: unvoting when no vote exists is a
   * no-op. Active-trip gated. Returns the option with its refreshed public tally.
   */
  async removeVote(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    await this.prisma.vote.deleteMany({
      where: { optionId: option.id, userId: user.id },
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /**
   * Say you are in for an option (post-launch, replacing the fixed headcount).
   *
   * Deliberately the same shape as {@link castVote} — same guard spine, same
   * idempotent upsert, same refreshed option in the response — because it is
   * the same kind of act: a member speaking for themselves, and only for
   * themselves. Nobody can opt anyone else in; an organizer who needs to
   * account for someone who never opens the app prices the option for the whole
   * group instead.
   *
   * **Rejected on a WHOLE_GROUP option** rather than silently recorded. There,
   * everyone is already in, so a row would be a claim the cost engine ignores —
   * and a control that appears to work while changing nothing is worse than one
   * that is not offered.
   */
  async joinOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);
    if (option.participationMode !== "OPT_IN") {
      throw new BadRequestException(
        "This option is priced for the whole trip, so everyone is already in.",
      );
    }

    await this.prisma.optionParticipant.upsert({
      where: { optionId_userId: { optionId: option.id, userId: user.id } },
      create: { optionId: option.id, userId: user.id },
      update: {},
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /**
   * Withdraw from an option. Idempotent, like un-voting.
   *
   * Allowed on a `WHOLE_GROUP` option too, where it is simply a no-op: leaving
   * something you were never individually signed up for should not be an error,
   * and the delete is already a `deleteMany` that matches nothing.
   */
  async leaveOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    await this.prisma.optionParticipant.deleteMany({
      where: { optionId: option.id, userId: user.id },
    });
    this.emitOptionsChanged(ctx.trip.id, categoryId);
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /** Re-read one option with its tally for the given viewer (post-vote/lock). */
  private async readOption(
    optionId: string,
    viewerId: string,
    memberCount: number,
  ): Promise<OptionView> {
    const fresh = await this.prisma.option.findUniqueOrThrow({
      where: { id: optionId },
      include: optionInclude,
    });
    return toOptionView(fresh, viewerId, memberCount);
  }

  /**
   * **Lock an option — the atomic-locking centerpiece (FR-24, decision 2).**
   *
   * A lock records the group's *decision* (distinct from advisory votes). It is
   * Organizer-only + Active-trip-only (both enforced by the caller/guard), and
   * the write is a **compare-and-set** so a second concurrent locker is rejected
   * with the current state rather than silently overwriting it. The guard entity
   * is **category-aware**:
   *
   *  - **multi-select** → serialize on the *option's* `version` + `PROPOSED`
   *    status (`updateMany` must affect exactly one row). Two organizers racing
   *    to lock the same option → the second's `optionVersion` is stale → 409.
   *  - **single-choice** → serialize on the *category's* `version` inside a
   *    transaction that also unlocks the previously-locked sibling(s) and locks
   *    the target. Two organizers racing to lock *different* options in the
   *    category → the second's `categoryVersion` is stale → 409, so only one
   *    decision can ever stand (FR-19).
   *
   * The whole thing — the compare-and-set, the sibling unlock, and the
   * {@link AuditEvent} writes — runs in **one transaction**, so the audit log can
   * never disagree with the decision and a crash can never leave two locked
   * options in a single-choice category.
   */
  async lockOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
    input: LockOptionInput,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    const category = await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);

    if (option.status === "LOCKED") {
      throw new ConflictException(
        "This option is already locked. Reload to see the current decision.",
      );
    }

    // Dates write-back (FR-8/25): locking a Dates-category option settles the
    // trip's dates. Validate + compute the new dates/expiry *before* the txn (a
    // bad start/end is a 400, independent of the concurrency guard).
    const dates = this.planDatesWriteBack(category.builtinKey, option);

    const tripId = ctx.trip.id;
    await this.prisma.$transaction(async (tx) => {
      if (category.singleChoice) {
        // Compare-and-set the CATEGORY version — the one-decision-per-category
        // serializer. If it moved, another organizer already decided.
        const cat = await tx.category.updateMany({
          where: { id: category.id, version: input.categoryVersion },
          data: { version: { increment: 1 } },
        });
        if (cat.count === 0) {
          throw new ConflictException(
            "Someone else changed this category's decision. Reload to see the current state.",
          );
        }
        // Displace the previously-locked sibling(s) — audited as superseded.
        const siblings = await tx.option.findMany({
          where: { categoryId: category.id, status: "LOCKED", deletedAt: null },
        });
        if (siblings.length > 0) {
          await tx.option.updateMany({
            where: {
              categoryId: category.id,
              status: "LOCKED",
              deletedAt: null,
            },
            data: {
              status: "PROPOSED",
              version: { increment: 1 },
              lockedById: null,
              lockedAt: null,
            },
          });
          for (const s of siblings) {
            await tx.auditEvent.create({
              data: auditData(tripId, user.id, "OPTION_UNLOCKED", s.id, {
                optionTitle: s.title,
                superseded: true,
              }),
            });
          }
        }
        // Lock the target — re-checked PROPOSED within the transaction.
        const locked = await tx.option.updateMany({
          where: {
            id: option.id,
            categoryId: category.id,
            status: "PROPOSED",
            deletedAt: null,
          },
          data: {
            status: "LOCKED",
            version: { increment: 1 },
            lockedById: user.id,
            lockedAt: new Date(),
          },
        });
        if (locked.count === 0) {
          throw new ConflictException(
            "This option can no longer be locked. Reload to see the current state.",
          );
        }
      } else {
        // Multi-select: compare-and-set the OPTION version + PROPOSED status.
        const locked = await tx.option.updateMany({
          where: {
            id: option.id,
            categoryId: category.id,
            version: input.optionVersion,
            status: "PROPOSED",
            deletedAt: null,
          },
          data: {
            status: "LOCKED",
            version: { increment: 1 },
            lockedById: user.id,
            lockedAt: new Date(),
          },
        });
        if (locked.count === 0) {
          throw new ConflictException(
            "Someone else changed this option. Reload to see the current state.",
          );
        }
      }
      await tx.auditEvent.create({
        data: auditData(tripId, user.id, "OPTION_LOCKED", option.id, {
          optionTitle: option.title,
        }),
      });
      // Same transaction: settle the trip's dates + expiry (Dates category only).
      if (dates) {
        await tx.trip.update({
          where: { id: tripId },
          data: {
            startDate: dates.startDate,
            endDate: dates.endDate,
            expiresAt: dates.expiresAt,
          },
        });
      }
    });

    this.emitOptionsChanged(ctx.trip.id, categoryId, "decision");
    // A settled decision is the notification everyone on the trip wants (5.1).
    // Unlocking is deliberately *not* a trigger — SRS §Phase-5 lists three, and
    // an unlock is an intermediate state, not news.
    await this.notifications.notify({
      tripId: ctx.trip.id,
      tripName: ctx.trip.name,
      actorId: user.id,
      actorName: user.displayName,
      type: "OPTION_LOCKED",
      subject: option.title,
      categoryId,
    });
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /**
   * Unlock a locked option (Organizers, Active trip). Frees the decision slot;
   * no category guard is needed (there is no sibling to displace), just a
   * compare-and-set on the option's `version` + `LOCKED` status so a stale unlock
   * is a 409. The unlock and its audit row commit together. Phase 2.5 hooks the
   * Dates-category date write-back onto lock/unlock; here it is category-agnostic.
   */
  async unlockOption(
    ctx: TripContext,
    user: User,
    categoryId: string,
    optionId: string,
    input: UnlockOptionInput,
  ): Promise<OptionView> {
    this.assertActive(ctx);
    const category = await this.requireCategory(ctx, categoryId);
    const option = await this.requireOption(categoryId, optionId);
    const tripId = ctx.trip.id;

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.option.updateMany({
        where: {
          id: option.id,
          categoryId,
          version: input.version,
          status: "LOCKED",
          deletedAt: null,
        },
        data: {
          status: "PROPOSED",
          version: { increment: 1 },
          lockedById: null,
          lockedAt: null,
        },
      });
      if (res.count === 0) {
        throw new ConflictException(
          "This option isn't locked as you last saw it. Reload to see the current state.",
        );
      }
      await tx.auditEvent.create({
        data: auditData(tripId, user.id, "OPTION_UNLOCKED", option.id, {
          optionTitle: option.title,
        }),
      });
      // Unlocking the Dates decision clears the trip's dates and reverts to the
      // created-`+1 year` fallback expiry (FR-9/25).
      if (category.builtinKey === "DATES") {
        await tx.trip.update({
          where: { id: tripId },
          data: {
            startDate: null,
            endDate: null,
            expiresAt: new Date(
              fallbackExpiresAt(ctx.trip.createdAt.getTime()),
            ),
          },
        });
      }
    });

    this.emitOptionsChanged(ctx.trip.id, categoryId, "decision");
    return this.readOption(option.id, user.id, ctx.trip._count.memberships);
  }

  /**
   * Validate + compute the trip's dates when a Dates-category option is locked
   * (FR-8/25). Returns the write-back for the Dates category, or `null` for any
   * other category (no date effect). A rejected date set is a 400.
   */
  private planDatesWriteBack(
    builtinKey: string | null,
    option: { startsAt: Date | null; endsAt: Date | null },
  ): { startDate: Date; endDate: Date; expiresAt: Date } | null {
    if (builtinKey !== "DATES") return null;
    const plan = planLockedDates(
      option.startsAt ? option.startsAt.toISOString() : null,
      option.endsAt ? option.endsAt.toISOString() : null,
      Date.now(),
      maxTripHorizonDays(),
    );
    if (!plan.ok) {
      throw new BadRequestException(DATE_REJECTION_MESSAGE[plan.reason]);
    }
    return {
      startDate: new Date(plan.startDate),
      endDate: new Date(plan.endDate),
      expiresAt: new Date(plan.expiresAt),
    };
  }
}

/**
 * User-facing messages for a rejected Dates lock (FR-25). Exported because trip
 * creation can now supply dates too, and seeds them as a pre-locked Dates option
 * — same rules, so it must be the same wording rather than a second set that
 * drifts.
 */
export const DATE_REJECTION_MESSAGE: Record<LockDatesRejection, string> = {
  NO_DATES: "Add a start and end date to this option before locking it.",
  END_BEFORE_START: "The end date can't be before the start date.",
  PAST: "You can't lock dates that start in the past.",
  OVER_HORIZON: "These dates are too far in the future to lock.",
};

/**
 * Build an {@link AuditEvent} row for a lock/unlock (written inside the txn).
 * Delegates to the shared builder so option and membership events land in the
 * same shape — the Phase-5.4 feed reads them through one mapper.
 */
const auditData = optionAudit;
