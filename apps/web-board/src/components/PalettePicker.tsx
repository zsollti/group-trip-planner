import type { CategoryPaletteKey } from "@gtp/types";
import { Dialog } from "./Dialog";
import {
  categoryPalette,
  PALETTE_KEYS,
  paletteHueStyle,
  paletteLabel,
  type CategoryIdentity,
} from "../lib/categoryTheme";
import { t } from "../lib/i18n";

/**
 * Repaint a lane: the eight palettes, and the way back to the default.
 *
 * **Every swatch shows all three of its colours**, in the proportions the lane
 * uses them — the edge on top, then the fill a decision gets, then the one a
 * candidate gets. A single blob of colour would only answer "which hue", and
 * the hue is the part someone can already see on the board; what they cannot
 * see before choosing is how the three tiers will read together, which is the
 * whole reason a palette is three colours and not one.
 *
 * The choice is **shared, not personal**, and the dialog says so. It is worth
 * saying: nothing else on the board changes what other people see from a menu
 * this quiet, and a colour is exactly the kind of setting people assume is
 * theirs alone.
 */
export function PalettePicker({
  category,
  busy,
  error,
  onPick,
  onClose,
}: {
  category: CategoryIdentity & { readonly name: string };
  busy: boolean;
  /** A refused write, shown here rather than on the board behind the backdrop. */
  error: string | null;
  /** Null puts the lane back to the palette it would have had. */
  onPick: (key: CategoryPaletteKey | null) => void;
  onClose: () => void;
}) {
  // What is on the board right now, whether or not anyone chose it — so the
  // dialog opens with the current colour marked rather than with nothing marked
  // on the untouched lanes, which is most of them.
  const current = categoryPalette(category);
  const isDefault = !category.paletteKey;

  return (
    <Dialog
      title={t("Colour for {lane}", { lane: category.name })}
      onClose={onClose}
    >
      <p className="board__dialog-note">
        {t("Everyone on this trip sees the colour you pick.")}
      </p>
      <div className="palette" role="group" aria-label={t("Palettes")}>
        {PALETTE_KEYS.map((key) => {
          const selected = key === current;
          return (
            <button
              key={key}
              type="button"
              className={
                "palette__swatch" + (selected ? t(" palette__swatch--on") : "")
              }
              style={paletteHueStyle(key)}
              // The name carries the state, so a screen reader is never asked
              // to infer "chosen" from a border.
              aria-pressed={selected}
              disabled={busy}
              onClick={() => onPick(key)}
            >
              <span className="palette__bars" aria-hidden="true">
                <i className="palette__bar palette__bar--main" />
                <i className="palette__bar palette__bar--locked" />
                <i className="palette__bar palette__bar--proposed" />
              </span>
              <span className="palette__name">{paletteLabel(key)}</span>
            </button>
          );
        })}
      </div>
      {/* Offered only once the lane has actually been repainted: on a lane
          nobody has touched, "use the default" is a button that does nothing,
          and the swatch for that default is already marked above. */}
      {isDefault ? null : (
        <button
          type="button"
          className="palette__reset"
          disabled={busy}
          onClick={() => onPick(null)}
        >
          {t("Back to this lane’s own colour")}
        </button>
      )}
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
