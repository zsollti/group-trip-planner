import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

/**
 * Validation for the query-string boundary (Phase 7.2).
 *
 * Bodies have been Zod-parsed since Phase 0.6 via `ZodValidationPipe`, but query
 * parameters were read as raw strings and handed to Prisma. A page cursor is an
 * id, and an id that isn't a UUID reaches Postgres as a failed cast — a 500
 * where the honest answer is "you sent a bad cursor". Nothing leaked (Nest masks
 * non-HTTP exceptions), but an unvalidated string reaching the database is the
 * boundary gap the sweep set out to close.
 *
 * Each `limit` is deliberately *not* rejected when out of range: the services
 * clamp it to their own maximum, which is friendlier than a 400 and equally
 * safe. Only unparseable input is refused here.
 */

const cursorSchema = z.string().uuid();

/** An opaque page cursor — always a row id. Absent stays absent; malformed is a
 *  400 rather than a database cast error. */
export function parseCursor(value?: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Invalid cursor");
  return parsed.data;
}

/** A required id in the query string (the chat catch-up anchor). */
export function requireIdParam(
  value: string | undefined,
  name: string,
): string {
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`Invalid ${name}`);
  return parsed.data;
}

/** A numeric query param; missing or non-numeric falls back to the service
 *  default, which then clamps it. */
export function parseLimit(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}
