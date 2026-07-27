import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { NotificationPage } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { parseCursor, parseLimit } from "../common/query-params.js";
import { NotificationsService } from "./notifications.service.js";

/** The unread badge, returned by both mark-read routes so the client never has
 * to re-fetch a page just to correct the count. */
interface UnreadCount {
  unreadCount: number;
}

/**
 * The notification bell (Phase 5.1). `JwtAuthGuard` only — notifications belong
 * to a **user**, not a trip, so there is no TripContextGuard here; every query is
 * filtered by the authenticated user's id in the service, which is what keeps one
 * account from reading or marking another's (the IDOR boundary for this module).
 */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** One page of the caller's notifications (newest first) + unread count. */
  @Get()
  list(
    @CurrentUser() user: User,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<NotificationPage> {
    return this.notifications.list(
      user.id,
      parseCursor(cursor),
      parseLimit(limit),
    );
  }

  /** Mark one notification read (idempotent). */
  @Post(":id/read")
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: User,
    @Param("id") id: string,
  ): Promise<UnreadCount> {
    return { unreadCount: await this.notifications.markRead(user.id, id) };
  }

  /** Mark every unread notification read ("clear the badge"). */
  @Post("read-all")
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: User): Promise<UnreadCount> {
    return { unreadCount: await this.notifications.markAllRead(user.id) };
  }
}
