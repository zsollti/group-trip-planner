import type { Category, CategoryBuiltinKey } from "@prisma/client";
import type { CategoryPaletteKey, CategoryView } from "@gtp/types";

/** A category row → the shared view the front-ends render from. */
export function toCategoryView(c: Category): CategoryView {
  return {
    id: c.id,
    name: c.name,
    singleChoice: c.singleChoice,
    isBuiltin: c.isBuiltin,
    builtinKey: c.builtinKey as CategoryBuiltinKey | null,
    // Null travels as null rather than being omitted: the front-end reads it as
    // "use the derived default", which is a real answer and not a missing one.
    paletteKey: c.paletteKey as CategoryPaletteKey | null,
    position: c.position,
    version: c.version,
  };
}
