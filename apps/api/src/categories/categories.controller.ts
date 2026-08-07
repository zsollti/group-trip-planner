import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  CreateCategoryInput,
  ReorderCategoriesInput,
  UpdateCategoryInput,
  type CategoryView,
} from "@gtp/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { CategoriesService } from "./categories.service.js";

/**
 * Planning categories, scoped under a trip (Phase 2.1). Every route runs
 * TripContextGuard first (non-members get a 404 — existence not leaked), then
 * PermissionGuard: reading needs only `trip.view` (any member), while every
 * mutation needs `category.manage` (Owner/Co-organizer). The reorder route is
 * declared before `:categoryId` so "reorder" isn't parsed as an id.
 */
@Controller("trips/:id/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** The trip's categories in display order (any member). */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  listCategories(@TripCtx() ctx: TripContext): Promise<CategoryView[]> {
    return this.categories.listCategories(ctx);
  }

  /** Create a custom category (Organizers), appended at the end. */
  @Post()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("category.manage")
  createCategory(
    @TripCtx() ctx: TripContext,
    @Body(new ZodValidationPipe(CreateCategoryInput)) body: CreateCategoryInput,
  ): Promise<CategoryView> {
    return this.categories.createCategory(ctx, body);
  }

  /** Reorder all of the trip's categories (Organizers). */
  @Post("reorder")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("category.manage")
  reorderCategories(
    @TripCtx() ctx: TripContext,
    @Body(new ZodValidationPipe(ReorderCategoriesInput))
    body: ReorderCategoriesInput,
  ): Promise<CategoryView[]> {
    return this.categories.reorderCategories(ctx, body);
  }

  /**
   * Update a category's name + selection mode (Organizers) — optimistic
   * concurrency, 409 on conflict, on Dates going multi-select, and on narrowing
   * to single-choice with more than one option still locked.
   */
  @Patch(":categoryId")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("category.manage")
  updateCategory(
    @TripCtx() ctx: TripContext,
    @Param("categoryId") categoryId: string,
    @Body(new ZodValidationPipe(UpdateCategoryInput)) body: UpdateCategoryInput,
  ): Promise<CategoryView> {
    return this.categories.updateCategory(ctx, categoryId, body);
  }

  /** Delete a category (Organizers) — hard cascade. Replies 204. */
  @Delete(":categoryId")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("category.manage")
  deleteCategory(
    @TripCtx() ctx: TripContext,
    @Param("categoryId") categoryId: string,
  ): Promise<void> {
    return this.categories.deleteCategory(ctx, categoryId);
  }
}
