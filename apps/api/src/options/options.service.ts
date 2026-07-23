import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import {
  canManageOption,
  hasMaterialChange,
  type CreateOptionInput,
  type LockOptionInput,
  type OptionView,
  type UnlockOptionInput,
  type UpdateOptionInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import {
  optionInclude,
  toMaterialSnapshot,
  toOptionView,
} from "./option.mapper.js";

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
  constructor(private readonly prisma: PrismaService) {}

  /** Reject any mutation on a frozen (History) trip. Phase 2.5 also treats a
   * trip past `expiresAt` as frozen; here only the persisted status is checked. */
  private assertActive(ctx: TripContext): void {
    if (ctx.trip.status === "HISTORY") {
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
      orderBy: { createdAt: "asc" },
    });
    return options.map((o) => toOptionView(o, viewerId));
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
      headcount: input.headcount ?? null,
      headcountIsFixed: input.headcountIsFixed,
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

    const created = await this.prisma.option.create({
      data: {
        ...this.toData(input),
        categoryId,
        proposerId: user.id,
      },
      include: optionInclude,
    });
    return toOptionView(created, user.id);
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
      headcount: input.headcount ?? null,
      headcountIsFixed: input.headcountIsFixed,
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
    return toOptionView(updated, user.id);
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
    return this.readOption(option.id, user.id);
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
    return this.readOption(option.id, user.id);
  }

  /** Re-read one option with its tally for the given viewer (post-vote/lock). */
  private async readOption(
    optionId: string,
    viewerId: string,
  ): Promise<OptionView> {
    const fresh = await this.prisma.option.findUniqueOrThrow({
      where: { id: optionId },
      include: optionInclude,
    });
    return toOptionView(fresh, viewerId);
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
    });

    return this.readOption(option.id, user.id);
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
    await this.requireCategory(ctx, categoryId);
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
    });

    return this.readOption(option.id, user.id);
  }
}

/** Build an {@link AuditEvent} row for a lock/unlock (written inside the txn). */
function auditData(
  tripId: string,
  actorId: string,
  action: "OPTION_LOCKED" | "OPTION_UNLOCKED",
  targetId: string,
  metadata: Prisma.InputJsonValue,
): Prisma.AuditEventUncheckedCreateInput {
  return { tripId, actorId, action, targetType: "OPTION", targetId, metadata };
}
