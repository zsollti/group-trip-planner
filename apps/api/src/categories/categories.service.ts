import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BUILTIN_CATEGORIES,
  DEFAULT_LOCALE,
  canBeMultiSelect,
  canDeleteCategory,
  maxTripCategories,
  OPTIONS_CHANGED_EVENT,
  type CreateCategoryInput,
  type CategoryView,
  type OptionsChanged,
  type UpdateCategoryInput,
  type Locale,
  type ReorderCategoriesInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import type { TripContext } from "../trips/trip-context.js";
import { toCategoryView } from "./category.mapper.js";
import { localizedException } from "../i18n/localized-message.js";
import { translate } from "../i18n/messages.js";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Seed a new trip's built-in categories (SRS §6). Called **inside the
   * trip-creation transaction** so a trip never exists without its categories;
   * takes the transaction client to share that atomic scope. The seed set and
   * its `singleChoice` defaults are the single definition in `@gtp/types`.
   *
   * The names are written in the **creator's** language. They are data from the
   * moment they land — renameable, and the same for everyone reading the board
   * — so this is the one chance to write them in a language anybody chose;
   * before it, a Hungarian organizer's board opened with four English lanes to
   * rename one at a time. The seed set stays English because it is the source
   * language and the key the catalogue is looked up by.
   */
  static seedBuiltins(
    tx: Prisma.TransactionClient,
    tripId: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<Prisma.BatchPayload> {
    return tx.category.createMany({
      data: BUILTIN_CATEGORIES.map((c) => ({
        tripId,
        name: translate(c.name, locale),
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
   * doesn't apply.
   *
   * Refused once the trip is at the policy-layer category cap — resolved via
   * `maxTripCategories`, never a literal, so a subscription tier can raise it
   * without touching this handler. The cap counts **all** categories, built-ins
   * included: it bounds the width of the lane row, and a seeded lane takes just
   * as much room as a custom one.
   */
  async createCategory(
    ctx: TripContext,
    input: CreateCategoryInput,
  ): Promise<CategoryView> {
    const count = await this.prisma.category.count({
      where: { tripId: ctx.trip.id },
    });
    const cap = maxTripCategories();
    if (count >= cap) {
      throw localizedException(
        (message) => new ForbiddenException(message),
        "This board is at its limit of {cap} categories. Delete one to add another.",
        { cap },
      );
    }

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
   * Update a category's name and selection mode, with optimistic concurrency
   * (SRS §6). The write is conditioned on the `version` the caller last saw:
   * `updateMany` touches zero rows if someone else changed it in the meantime,
   * surfaced as a 409 so the front-end can prompt a reload. A category from
   * another trip is a plain 404 (scoped lookup — no cross-trip edit). Built-ins
   * are renamable (FR-18); their `builtinKey` preserves identity regardless of
   * the display name.
   *
   * Two rules guard the selection mode, both 409 rather than 403 — neither is
   * about the caller's role, and an Owner is refused for the same reason anyone
   * else is:
   *
   *  - **Dates is always single-choice** ({@link canBeMultiSelect}). The trip
   *    holds one date range, written from the one locked Dates option; a second
   *    winner there would have nothing to write back to.
   *  - **Narrowing to single-choice needs the extra winners gone first.** A
   *    single-choice category's invariant is at most one locked option, and the
   *    lock path keeps it by unlocking the sibling as it goes. Flipping the flag
   *    under two locked options would leave the category already in violation,
   *    with no user action having chosen which one survives. Refused, naming the
   *    count — the caller unlocks down to one and tries again.
   */
  async updateCategory(
    ctx: TripContext,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryView> {
    const existing = await this.requireCategory(ctx, categoryId);

    if (!input.singleChoice && !canBeMultiSelect(existing)) {
      throw new ConflictException(
        "Dates has to stay single-choice, because the trip runs over one date range.",
      );
    }
    if (input.singleChoice && !existing.singleChoice) {
      const locked = await this.prisma.option.count({
        where: {
          categoryId: existing.id,
          status: "LOCKED",
          deletedAt: null,
        },
      });
      if (locked > 1) {
        throw localizedException(
          (message) => new ConflictException(message),
          "“{name}” has {locked} decided options. Unlock all but one before making it single-choice.",
          { name: existing.name, locked },
        );
      }
    }

    const result = await this.prisma.category.updateMany({
      where: { id: existing.id, version: input.version },
      data: {
        name: input.name,
        singleChoice: input.singleChoice,
        // A full-object replace like the fields beside it: an omitted palette
        // has been cleared back to the derived default, not left alone.
        paletteKey: input.paletteKey,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "This category was changed since you opened it. Reload to see the latest.",
      );
    }

    const updated = await this.prisma.category.findUniqueOrThrow({
      where: { id: existing.id },
    });
    // Everyone on the board, not just whoever made the change. A lane's colour
    // and its name are how the rest of the trip recognises it, so a repaint
    // that only the person holding the picker could see would be a private
    // edit to shared state — and the whole point of storing it is that it is
    // not private. The event's own name is about options, but its payload is
    // "something about this lane changed" and its handler already refreshes the
    // category list, which is exactly what this needs.
    this.realtime.emitToTrip(ctx.trip.id, OPTIONS_CHANGED_EVENT, {
      tripId: ctx.trip.id,
      categoryId: existing.id,
      kind: "category",
    } satisfies OptionsChanged);
    return toCategoryView(updated);
  }

  /**
   * Delete a category — a **hard cascade** (SRS FR-20): its options, votes, and
   * (Phase 4) chat channel go with it, and the loss is permanent even in History
   * (accepted, SRS §15). The front-ends surface that in the delete confirmation.
   *
   * The Dates category is the one exception ({@link canDeleteCategory}) — 409
   * rather than 403, because this isn't about the caller's role: no one may
   * delete it, Owner included.
   */
  async deleteCategory(ctx: TripContext, categoryId: string): Promise<void> {
    const existing = await this.requireCategory(ctx, categoryId);
    if (!canDeleteCategory(existing)) {
      throw new ConflictException(
        "The Dates category can't be deleted. It's the trip's only way to set its dates.",
      );
    }
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
