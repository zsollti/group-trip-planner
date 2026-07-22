import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z, ZodTypeAny } from "zod";

/**
 * Validates a request payload against a shared Zod schema (@gtp/types) and
 * returns the parsed, typed value. Used as `@Body(new ZodValidationPipe(Schema))`.
 *
 * Field-level validation errors (format/length) are safe to surface — they help
 * the front-end forms and never reveal whether an account exists. Enumeration
 * resistance lives in the auth service logic, not here.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
