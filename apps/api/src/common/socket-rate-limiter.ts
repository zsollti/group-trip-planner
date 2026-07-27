import { Injectable } from "@nestjs/common";

/**
 * A per-key fixed-window rate limiter for socket events (Phase 7.1).
 *
 * `@nestjs/throttler` cannot do this job: `ThrottlerGuard` reaches for its
 * request/response pair via `context.switchToHttp()`, which on a
 * `@SubscribeMessage` handler returns the socket client and the raw payload —
 * so its IP tracker reads `undefined` and its header writes would be called on
 * a message body. Socket events were therefore governed by nothing at all.
 * This is the small amount of state needed to close that, and nothing more.
 *
 * Fixed window rather than a sliding log or token bucket: a window boundary
 * lets through at most one extra burst, which for chat is harmless, and the
 * cost is one integer per active sender instead of a timestamp list.
 *
 * In-memory, like the default throttler storage. That is correct for a single
 * instance and degrades gracefully across several: each holds its own counter,
 * so N instances allow at most N× the budget — still bounded, still far below
 * an unlimited flood. Moving to Redis is the same change the HTTP throttler
 * would need and is deferred with it (7.5 decides whether Redis exists at all).
 */
@Injectable()
export class SocketRateLimiter {
  /** key → current window's start time and hit count. */
  private readonly windows = new Map<
    string,
    { startedAt: number; hits: number }
  >();

  /** Entries are only swept when this many keys have accumulated. */
  private static readonly SWEEP_THRESHOLD = 1_000;

  /**
   * Count one event against `key` and report whether it is allowed.
   *
   * @param key    what the budget belongs to — a user id, not a connection, so
   *               opening a second tab cannot double someone's allowance.
   * @param limit  events permitted per window.
   * @param windowMs  window length in milliseconds.
   */
  consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    const existing = this.windows.get(key);

    if (!existing || now - existing.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: now, hits: 1 });
      this.sweep(now, windowMs);
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.hits >= limit) {
      return {
        allowed: false,
        retryAfterMs: existing.startedAt + windowMs - now,
      };
    }

    existing.hits += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Drop windows that have already expired.
   *
   * Without this the map is a slow leak: every user who ever sends a message
   * would keep an entry for the life of the process. It runs only when the map
   * has grown past a threshold, so the common path stays O(1).
   */
  private sweep(now: number, windowMs: number): void {
    if (this.windows.size < SocketRateLimiter.SWEEP_THRESHOLD) return;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= windowMs) this.windows.delete(key);
    }
  }
}
