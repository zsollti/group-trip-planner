import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isTripFrozen,
  maxPersonalItems,
  type CreatePersonalItemInput,
  type PersonalItemView,
  type ReorderPersonalItemsInput,
  type UpdatePersonalItemInput,
} from "@gtp/types";
import { localizedException } from "../i18n/localized-message.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toPersonalItemView } from "./personal-item.mapper.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Personal items (post-launch) — one member's private list on one trip.
 *
 * ## The single invariant
 *
 * **Every query in this file is scoped by `{ tripId, ownerId }`, and there is
 * no method that takes an item id without also taking the owner.** Not one
 * `findUnique({ where: { id } })`. That is deliberate and it is the whole
 * security model: it makes "somebody else's item" indistinguishable from "no
 * such item" without any handler having to remember a check, and it means a
 * future method added to this class inherits the property by following the
 * shape of the ones already here rather than by being reviewed for it.
 *
 * The route guards do their usual job first — {@link TripContextGuard} 404s a
 * non-member so trip existence is never leaked, then the permission guard
 * checks `personalItem.manage`, which every role holds including Guest. But
 * neither of those separates one member from another *inside* a trip, and that
 * is the separation this data needs. The guards say "you are on this trip";
 * the scoping here says "these are yours".
 *
 * ## What it does not do
 *
 * No realtime broadcast. Options emit `OPTIONS_CHANGED` into the trip room
 * because a proposal is news to everybody; a personal item is news to nobody,
 * and pushing one into the trip room would be announcing the existence of a
 * row that the recipients are not allowed to read. The owner's own client
 * invalidates its query and that is the entire fan-out. (If a second device
 * should follow along later, `RealtimeGateway.toUser` and the per-person
 * `userRoom` already exist for it — the seam is there, unused on purpose.)
 *
 * No audit events either. The activity feed is the trip's shared story, and a
 * private row has no place in a log every member reads.
 */
@Injectable()
export class PersonalItemsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own items on this trip, in their own order. */
  async listItems(
    ctx: TripContext,
    ownerId: string,
  ): Promise<PersonalItemView[]> {
    const items = await this.prisma.personalItem.findMany({
      where: { tripId: ctx.trip.id, ownerId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return items.map(toPersonalItemView);
  }

  /**
   * Add one. Active-trip gated and capped by the policy layer.
   *
   * The cap counts **this member's** rows, not the trip's: it exists so one
   * person cannot balloon their own payload, and a shared quota would let an
   * enthusiastic planner use up a limit on their friends' behalf.
   */
  async createItem(
    ctx: TripContext,
    ownerId: string,
    input: CreatePersonalItemInput,
  ): Promise<PersonalItemView> {
    this.assertActive(ctx);
    const categoryId = await this.resolveTag(ctx, input.categoryId);

    const held = await this.prisma.personalItem.count({
      where: { tripId: ctx.trip.id, ownerId },
    });
    const cap = maxPersonalItems();
    if (held >= cap) {
      throw localizedException(
        (message) => new ForbiddenException(message),
        "Your own list is full at {cap} items. Remove one to add another.",
        { cap },
      );
    }

    const last = await this.prisma.personalItem.aggregate({
      where: { tripId: ctx.trip.id, ownerId },
      _max: { position: true },
    });

    const created = await this.prisma.personalItem.create({
      data: {
        ...this.toData(input),
        categoryId,
        tripId: ctx.trip.id,
        ownerId,
        position: (last._max.position ?? -1) + 1,
      },
    });
    return toPersonalItemView(created);
  }

  /**
   * Replace one of your own. A full-object write, like an option edit: an
   * omitted optional field clears it.
   *
   * No `version` and so no 409. An option carries optimistic concurrency
   * because several people can be editing it; this row has exactly one possible
   * editor, and the only race left is that person's own two tabs — where
   * last-write-wins is the bargain every other single-owner form in the app
   * already makes.
   */
  async updateItem(
    ctx: TripContext,
    ownerId: string,
    itemId: string,
    input: UpdatePersonalItemInput,
  ): Promise<PersonalItemView> {
    this.assertActive(ctx);
    const existing = await this.requireOwnItem(ctx, ownerId, itemId);
    const categoryId = await this.resolveTag(ctx, input.categoryId);

    const updated = await this.prisma.personalItem.update({
      where: { id: existing.id },
      data: { ...this.toData(input), categoryId },
    });
    return toPersonalItemView(updated);
  }

  /**
   * Delete one of your own — a hard delete, not the soft one options get.
   *
   * An option is soft-deleted because votes, an audit trail and a decision
   * history hang off it and the group may need to account for something that
   * was on the table. Nothing hangs off a personal item, and nobody but its
   * owner ever knew it existed, so keeping a hidden copy of private data after
   * its owner asked for it to go would be storage without a purpose.
   */
  async deleteItem(
    ctx: TripContext,
    ownerId: string,
    itemId: string,
  ): Promise<void> {
    this.assertActive(ctx);
    const existing = await this.requireOwnItem(ctx, ownerId, itemId);
    await this.prisma.personalItem.delete({ where: { id: existing.id } });
  }

  /**
   * Reorder your own column. Mirrors the option reorder: the client sends the
   * complete set of its live ids and the server assigns `position` by index in
   * one transaction, so the write is idempotent and gap-free.
   *
   * The completeness check is also the authorization check. The ids are matched
   * against `{ tripId, ownerId }` and the count must equal what the caller
   * actually holds, so a list padded with somebody else's id fails as a
   * malformed reorder rather than reaching a row it should not — and fails
   * without revealing which of the ids was the stranger.
   */
  async reorderItems(
    ctx: TripContext,
    ownerId: string,
    input: ReorderPersonalItemsInput,
  ): Promise<PersonalItemView[]> {
    this.assertActive(ctx);
    const owned = await this.prisma.personalItem.findMany({
      where: { tripId: ctx.trip.id, ownerId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));
    const requested = new Set(input.orderedIds);
    if (
      requested.size !== input.orderedIds.length ||
      requested.size !== ownedIds.size ||
      input.orderedIds.some((id) => !ownedIds.has(id))
    ) {
      throw new BadRequestException(
        "Reorder must list each of your own items exactly once.",
      );
    }

    await this.prisma.$transaction(
      input.orderedIds.map((id, position) =>
        this.prisma.personalItem.update({ where: { id }, data: { position } }),
      ),
    );
    return this.listItems(ctx, ownerId);
  }

  /** Frozen = persisted History **or** past `expiresAt` (FR-10, decision 4). */
  private assertActive(ctx: TripContext): void {
    if (isTripFrozen(ctx.trip.status, ctx.trip.expiresAt.toISOString())) {
      throw new ForbiddenException(
        "This trip has ended and can no longer be changed.",
      );
    }
  }

  /**
   * Validate the optional lane tag against **this** trip.
   *
   * A uuid that parses is not a uuid that belongs here. Without this check a
   * member could tag their item with a category id from a trip they have never
   * seen, and the row would quietly hold a reference to something its owner was
   * never shown — plus the board would ask for a colour from a lane that is not
   * on it. Absent or blank clears the tag; a stranger id is a 404 on the
   * category, the same answer the options routes give.
   */
  private async resolveTag(
    ctx: TripContext,
    categoryId: string | null | undefined,
  ): Promise<string | null> {
    if (categoryId === undefined || categoryId === null) return null;
    if (!UUID_RE.test(categoryId)) {
      throw new NotFoundException("Category not found");
    }
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, tripId: ctx.trip.id },
      select: { id: true },
    });
    if (!category) throw new NotFoundException("Category not found");
    return category.id;
  }

  /**
   * One of the caller's own items, or 404.
   *
   * Scoped on all three columns at once, so a real id belonging to another
   * member of the same trip is not "forbidden" — it is *not found*, which is
   * the only answer that does not confirm the row exists.
   */
  private async requireOwnItem(
    ctx: TripContext,
    ownerId: string,
    itemId: string,
  ) {
    if (!UUID_RE.test(itemId)) {
      throw new NotFoundException("Item not found");
    }
    const item = await this.prisma.personalItem.findFirst({
      where: { id: itemId, tripId: ctx.trip.id, ownerId },
    });
    if (!item) throw new NotFoundException("Item not found");
    return item;
  }

  /** The editable columns, shared by create and update. */
  private toData(input: CreatePersonalItemInput | UpdatePersonalItemInput) {
    return {
      title: input.title,
      description: input.description ?? null,
      url: input.url ?? null,
      amount: input.amount ?? null,
      currency: input.currency,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    };
  }
}
