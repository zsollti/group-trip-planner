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
  type OptionView,
  type UpdateOptionInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toMaterialSnapshot, toOptionView } from "./option.mapper.js";

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

  /** Live options in a category (newest last), any member (`trip.view`). */
  async listOptions(
    ctx: TripContext,
    categoryId: string,
  ): Promise<OptionView[]> {
    await this.requireCategory(ctx, categoryId);
    const options = await this.prisma.option.findMany({
      where: { categoryId, deletedAt: null },
      include: { proposer: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return options.map(toOptionView);
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
      include: { proposer: { select: { displayName: true } } },
    });
    return toOptionView(created);
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
      include: { proposer: { select: { displayName: true } } },
    });
    return toOptionView(updated);
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
}
