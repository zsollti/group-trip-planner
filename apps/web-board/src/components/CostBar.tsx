/**
 * A restrained per-currency cost bar (Phase 3.5, `dataviz`). One measure — money
 * — in two states of the **same hue**: a solid "committed" (locked) segment and a
 * hatched "projected-extra" segment (what the open-category front-runners would
 * add). Texture, not a second colour, distinguishes the states, so it reads for
 * colourblind viewers and in print. The bar is normalised to this currency's own
 * projected total (never summed across currencies, FR-27) and is `aria-hidden` —
 * the exact figures are shown as text beside it, which is the accessible source.
 */
export function CostBar({
  committed,
  projected,
}: {
  committed: number;
  projected: number;
}) {
  const max = Math.max(projected, committed, 0);
  const committedPct = max > 0 ? (Math.min(committed, max) / max) * 100 : 0;
  const extraPct =
    max > 0 ? (Math.max(projected - committed, 0) / max) * 100 : 0;

  return (
    <div className="tally-bar" aria-hidden="true">
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
    </div>
  );
}
