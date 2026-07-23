import type { Category, CategoryBuiltinKey } from "@prisma/client";
import type { CategoryView } from "@gtp/types";

/** A category row → the shared view the front-ends render from. */
export function toCategoryView(c: Category): CategoryView {
  return {
    id: c.id,
    name: c.name,
    singleChoice: c.singleChoice,
    isBuiltin: c.isBuiltin,
    builtinKey: c.builtinKey as CategoryBuiltinKey | null,
    position: c.position,
    version: c.version,
  };
}
