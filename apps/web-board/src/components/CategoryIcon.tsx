import { categoryIconKey } from "../lib/categoryTheme";
import { CATEGORY_ICON_PATHS } from "../lib/categoryIconPaths";
import { Glyph } from "./icons";
import type { CategoryBuiltinKey } from "@gtp/types";

/**
 * The mark that identifies a category at a glance.
 *
 * **Drawn, not typed.** The board reaches for an emoji elsewhere (🗓, 💬, ✦) and
 * that is fine for a one-off decoration, but this one is an identity: it sits in
 * every lane header, on every timeline tag, and it has to hold its shape at
 * 14px. An emoji is rendered by the reader's OS, so the same board is a flat
 * glyph on Windows, a glossy pictogram on iOS and a tofu box on a Linux box
 * missing the font — three different identities for one category. These are
 * paths, so they are the same everywhere and they take the category's own colour
 * from `currentColor`.
 *
 * Always `aria-hidden`: the category's name is rendered beside it in every
 * position, so announcing the icon would only repeat what was just read.
 */

export function CategoryIcon({
  category,
  size = 16,
  className,
}: {
  category: { readonly builtinKey: CategoryBuiltinKey | null };
  size?: number;
  className?: string;
}) {
  return (
    <Glyph
      size={size}
      className={["cat-icon", className].filter(Boolean).join(" ")}
    >
      {CATEGORY_ICON_PATHS[categoryIconKey(category)]}
    </Glyph>
  );
}
