import { z } from "zod";

/**
 * The field-level primitives shared by every surface that describes *a thing
 * with a price and some dates* — options (Phase 2.2) and personal items
 * (post-launch).
 *
 * **Internal to the package on purpose.** `index.ts` does not re-export this
 * module: these are building blocks, not contract shapes, and `@gtp/types`
 * offering `optionalText` at the top level would say they were meant to be
 * composed by consumers. The modules that need them import from here directly.
 *
 * They lived in `options.ts` as module-private consts until personal items
 * needed the same rules. Copying them would have made "what the server accepts"
 * two definitions that agree only until one of them is edited — and the whole
 * point of a personal item is that it is priced and dated the same way an
 * option is, so a reader who learns one form has learned the other.
 *
 * {@link isHttpUrl} is the exception to the internal rule: the render side has
 * always imported it from `@gtp/types`, so `options.ts` re-exports it and that
 * public path is unchanged.
 */

/** True only for absolute `http:`/`https:` URLs. Shared with the render side so
 * one rule governs both what may be stored and what may be linked. */
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** Optional free text, trimmed and bounded; empty normalises to undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Optional URL (proposal link / booking hook). Empty normalises to undefined.
 *
 * `.url()` alone is **not** a scheme check: it delegates to `new URL()`, which
 * happily parses `javascript:alert(1)` and `data:text/html,…`. This value is
 * rendered straight into an `href` on the board, so the scheme is constrained
 * here at the boundary rather than trusted downstream (Phase 7.2). React 19
 * does currently neutralise `javascript:` hrefs on its own, but that is the
 * renderer being defensive, not the contract being correct — and it protects
 * only consumers that happen to be React.
 */
export const optionalUrl = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .url()
      .max(max)
      .refine(isHttpUrl, { message: "Must be an http(s) link" })
      .optional(),
  );

/** Optional non-negative money amount; blank/NaN normalises to undefined. */
export const optionalAmount = z.preprocess(
  (v) =>
    v === "" || v === null || (typeof v === "number" && Number.isNaN(v))
      ? undefined
      : v,
  z.number().nonnegative().max(1_000_000_000).optional(),
);

/** Optional ISO date-time; empty normalises to undefined. */
export const optionalDateTime = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().datetime({ offset: true }).optional(),
);

/** A 3-letter ISO currency code, upper-cased on the way in. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code");

/**
 * The one cross-field rule a dated thing carries: if both ends are given, the
 * end must not precede the start.
 *
 * Written as a refinement over the loosest possible shape rather than over a
 * particular body schema, so the same rule can be attached to an option body
 * and a personal-item body without either knowing about the other. The error
 * is pathed at `endsAt` because that is the field a form should light up: the
 * start is rarely the half the reader got wrong.
 */
export function endNotBeforeStart(
  val: { startsAt?: string | undefined; endsAt?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (
    val.startsAt !== undefined &&
    val.endsAt !== undefined &&
    Date.parse(val.endsAt) < Date.parse(val.startsAt)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End must not be before start.",
    });
  }
}
