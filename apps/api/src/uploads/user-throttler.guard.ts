import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import type { User } from "@prisma/client";

/**
 * A {@link ThrottlerGuard} that counts **per user** rather than per IP.
 *
 * The stock tracker keys on the client address, which is the wrong unit for an
 * authenticated, expensive endpoint: everyone behind one office NAT would share
 * a single budget, while one account switching networks would get a fresh one.
 * Uploads run `sharp` per request, so the thing worth limiting is the account
 * doing it.
 *
 * Falls back to the IP when no user is attached, so the guard is still safe if
 * it is ever mounted without an auth guard in front.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: User }).user;
    return Promise.resolve(user ? `user:${user.id}` : `ip:${req.ip ?? ""}`);
  }
}
