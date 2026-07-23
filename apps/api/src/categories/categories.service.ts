import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BUILTIN_CATEGORIES,
  type CreateCategoryInput,
  type CategoryView,
  type RenameCategoryInput,
  type ReorderCategoriesInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toCategoryView } from "./category.mapper.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Category management (Phase 2.1, SRS §6 / FR-18–20). The route guards resolve
 * the trip + caller role (404 for non-members) and enforce the coarse capability
 * (`trip.view` to list, `category.manage` to mutate); the service owns the data
 * rules — append-at-end positioning, optimistic-concurrency rename, hard-cascade
 * delete, and full-set reorder.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed a new trip's five built-in categories (SRS §6). Called **inside the
   * trip-creation transaction** so a trip never exists without its categories;
   * takes the transaction client to share that atomic scope. The seed set and
   * its `singleChoice` defaults are the single definition in `@gtp/types`.
   */
  static seedBuiltins(
    tx: Prisma.TransactionClient,
    tripId: string,
  ): Promise<Prisma.BatchPayload> {
    return tx.category.createMany({
      data: BUILTIN_CATEGORIES.map((c) => ({
        tripId,
        name: c.name,
        singleChoice: c.singleChoice,
        isBuiltin: true,
        builtinKey: c.builtinKey,
        position: c.position,
      })),
    });
  }

  /** The trip's categories in display order (any member — `trip.view`). */
  async listCategories(ctx: TripContext): Promise<CategoryView[]> {
    const categories = await this.prisma.category.findMany({
      where: { tripId: ctx.trip.id },
      orderBy: { position: "asc" },
    });
    return categories.map(toCategoryView);
  }

  /**
   * Create a custom category, appended after the existing ones. It is never a
   * built-in (no `builtinKey`), so the `[tripId, builtinKey]` unique constraint
   * doesn't apply — a trip may hold any number of custom categories.
   */
  async createCategory(
    ctx: TripContext,
    input: CreateCategoryInput,
  ): Promise<CategoryView> {
    const last = await this.prisma.category.aggregate({
      where: { tripId: ctx.trip.id },
      _max: { position: true },
    });
    const nextPosition = (last._max.position ?? -1) + 1;

    const created = await this.prisma.category.create({
      data: {
        tripId: ctx.trip.id,
        name: input.name,
        singleChoice: input.singleChoice,
        isBuiltin: false,
        position: nextPosition,
      },
    });
    return toCategoryView(created);
  }

  /**
   * Rename a category with optimistic concurrency (SRS §6). The write is
   * conditioned on the `version` the caller last saw: `updateMany` touches zero
   * rows if someone else renamed it in the meantime, surfaced as a 409 so the
   * front-end can prompt a reload. A category from another trip is a plain 404
   * (scoped lookup — no cross-trip edit). Built-ins are renamable (FR-18); their
   * `builtinKey` preserves identity regardless of the display name.
   */
  async renameCategory(
    ctx: TripContext,
    categoryId: string,
    input: RenameCategoryInput,
  ): Promise<CategoryView> {
    const existing = await this.requireCategory(ctx, categoryId);

    const result = await this.prisma.category.updateMany({
      where: { id: existing.id, version: input.version },
      data: { name: input.name, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "This category was changed since you opened it. Reload to see the latest.",
      );
    }

    const updated = await this.prisma.category.findUniqueOrThrow({
      where: { id: existing.id },
    });
    return toCategoryView(updated);
  }

  /**
   * Delete a category — a **hard cascade** (SRS FR-20): its options, votes, and
   * (Phase 4) chat channel go with it, and the loss is permanent even in History
   * (accepted, SRS §15). The front-ends surface that in the delete confirmation.
   */
  async deleteCategory(ctx: TripContext, categoryId: string): Promise<void> {
    const existing = await this.requireCategory(ctx, categoryId);
    await this.prisma.category.delete({ where: { id: existing.id } });
  }

  /**
   * Reorder the trip's categories. The caller sends the **full** set of category
   * ids in the desired order; anything else (a missing or unknown id, a
   * duplicate, a wrong count) is a 400 — this keeps `position` gap-free and makes
   * the write idempotent. Positions are reassigned by index in one transaction.
   */
  async reorderCategories(
    ctx: TripContext,
    input: ReorderCategoriesInput,
  ): Promise<CategoryView[]> {
    const current = await this.prisma.category.findMany({
      where: { tripId: ctx.trip.id },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const requested = input.orderedIds;
    const requestedSet = new Set(requested);

    const isFullPermutation =
      requested.length === current.length &&
      requestedSet.size === requested.length &&
      requested.every((id) => currentIds.has(id));
    if (!isFullPermutation) {
      throw new BadRequestException(
        "Reorder must list each of the trip's categories exactly once.",
      );
    }

    await this.prisma.$transaction(
      requested.map((id, index) =>
        this.prisma.category.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    return this.listCategories(ctx);
  }

  /**
   * Load a category scoped to this trip. A malformed id or a category from
   * another trip is an identical 404 — no cross-trip probing, no existence leak.
   */
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
}
