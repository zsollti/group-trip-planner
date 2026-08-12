import { costScale } from "../lib/costScale";

/**
 * A restrained per-currency cost bar (Phase 3.5, `dataviz`). One measure — money
 * — in two states of the **same hue**: a solid "committed" (locked) segment and a
 * hatched "projected-extra" segment (what the open-category front-runners would
 * add). Texture, not a second colour, distinguishes the states, so it reads for
 * colourblind viewers and in print. The bar is normalised to this currency's own
 * projected total (never summed across currencies, FR-27) and is `aria-hidden` —
 * the exact figures are shown as text beside it, which is the accessible source.
 *
 * Given a `target` the width means more than the split (post-launch): under it
 * the track is the target and the fill is how much of it is spoken for, over it
 * the track is the spend and a red rule marks where the target ran out. The
 * arithmetic, and the reasoning for it, live in `lib/costScale`.
 *
 * `committed`, `projected` and `target` must all be in the same unit. A target
 * is per person here, so the caller hands this per-person money whenever it
 * passes one — the mark and the sentence beneath it are then reading the same
 * figures, and cannot end up disagreeing in front of the user.
 */
export function CostBar({
  committed,
  projected,
  target,
}: {
  committed: number;
  projected: number;
  target?: number | null;
}) {
  const { committedPct, extraPct, markerPct, againstTarget } = costScale({
    committed,
    projected,
    target,
  });

  return (
    <div
      className={"tally-bar" + (againstTarget ? " tally-bar--target" : "")}
      aria-hidden="true"
    >
      {committedPct > 0 ? (
        <div
          className="tally-bar__seg tally-bar__seg--committed"
          style={{ width: `${committedPct}%` }}
        />
      ) : null}
      {extraPct > 0 ? (
        <div
          className="tally-bar__seg tally-bar__seg--extra"
          style={{ width: `${extraPct}%` }}
        />
      ) : null}
      {markerPct === null ? null : (
        <span className="tally-bar__limit" style={{ left: `${markerPct}%` }} />
      )}
    </div>
  );
}
