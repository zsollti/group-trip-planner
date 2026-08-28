import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  CreatePersonalItemInput,
  ReorderPersonalItemsInput,
  SetPersonalBudgetInput,
  UpdatePersonalItemInput,
  type PersonalBudgetView,
  type PersonalItemView,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { UserThrottlerGuard } from "../common/user-throttler.guard.js";
import { OPTION_CREATE_THROTTLE } from "../common/throttle-policy.js";
import { PerUserThrottle } from "../common/per-user-throttle.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { PersonalItemsService } from "./personal-items.service.js";

/**
 * A member's own private items on a trip (post-launch).
 *
 * Every route runs TripContextGuard first (a non-member gets a 404, so trip
 * existence is never leaked), then PermissionGuard on `personalItem.manage` —
 * a row every role holds, Guest included, because none of this touches shared
 * state and a Guest deciding whether to join is exactly who wants to price
 * their own flight.
 *
 * **The guards are not the separation that matters here.** They establish that
 * the caller is on this trip; they say nothing about which member is which.
 * The per-owner scoping lives in the service, where every query is keyed on
 * `{ tripId, ownerId }` and no method accepts an item id without the owner
 * beside it. `@CurrentUser()` is the only source of that id — it is never a
 * parameter, a body field, or anything else a client could choose.
 */
@Controller("trips/:id/personal-items")
export class PersonalItemsController {
  constructor(private readonly items: PersonalItemsService) {}

  /** The caller's own items on this trip, in their own order. */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  listItems(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
  ): Promise<PersonalItemView[]> {
    return this.items.listItems(ctx, user.id);
  }

  /**
   * Reorder the caller's own column. Declared before the `:itemId` routes so
   * "reorder" is never parsed as an item id.
   */
  @Post("reorder")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  reorderItems(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(ReorderPersonalItemsInput))
    body: ReorderPersonalItemsInput,
  ): Promise<PersonalItemView[]> {
    return this.items.reorderItems(ctx, user.id, body);
  }

  /**
   * Add an item. Shares the option-create budget: it is the same kind of write
   * at the same kind of rate, and a second budget would be a second number to
   * keep in step for no behavioural difference.
   */
  @Post()
  @UseGuards(
    JwtAuthGuard,
    TripContextGuard,
    PermissionGuard,
    UserThrottlerGuard,
  )
  @PerUserThrottle(OPTION_CREATE_THROTTLE)
  @RequirePermission("personalItem.manage")
  createItem(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(CreatePersonalItemInput))
    body: CreatePersonalItemInput,
  ): Promise<PersonalItemView> {
    return this.items.createItem(ctx, user.id, body);
  }

  /** Edit one of the caller's own items. */
  @Patch(":itemId")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  updateItem(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(UpdatePersonalItemInput))
    body: UpdatePersonalItemInput,
  ): Promise<PersonalItemView> {
    return this.items.updateItem(ctx, user.id, itemId, body);
  }

  /** Delete one of the caller's own items. Replies 204. */
  @Delete(":itemId")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  deleteItem(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("itemId") itemId: string,
  ): Promise<void> {
    return this.items.deleteItem(ctx, user.id, itemId);
  }
}

/**
 * The caller's own spending limit for one trip (post-launch).
 *
 * A path of its own rather than a route under `personal-items`, because it is
 * not an item: it is one figure on the caller's membership, the way `chat-mute`
 * is. Nesting it there would also have put it in the way of the `:itemId`
 * routes for no gain.
 *
 * Gated `personalItem.manage`, the same row the private list holds, and for the
 * same reason: none of this touches shared state, and a Guest deciding whether
 * to come is exactly the person who wants to say what they can spend.
 *
 * **Always about the caller.** There is no user id in the path or the body, so
 * there is no shape in which one member reads or writes another's figure. The
 * service scopes every query `{ tripId, userId }` from `@CurrentUser()` on top
 * of that.
 */
@Controller("trips/:id/personal-budget")
export class PersonalBudgetController {
  constructor(private readonly items: PersonalItemsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  get(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
  ): Promise<PersonalBudgetView> {
    return this.items.getBudget(ctx, user.id);
  }

  /**
   * `PUT` because the body is the whole of the setting every time: it says what
   * the budget should now be, not how to adjust what it was, so sending the
   * same request twice leaves the same state.
   */
  @Put()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("personalItem.manage")
  set(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(SetPersonalBudgetInput))
    body: SetPersonalBudgetInput,
  ): Promise<PersonalBudgetView> {
    return this.items.setBudget(ctx, user.id, body.amount);
  }
}
