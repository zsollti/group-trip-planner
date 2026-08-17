import { costScale } from "../lib/costScale";
import { t } from "../lib/i18n";

/**
 * The cost surface's one chart (`dataviz`): locked spend against the target.
 *
 * One measure, one hue, no legend — a single series names itself from the
 * figures printed directly above it. It is `aria-hidden`, because those figures
 * *are* the accessible version and a screen reader reading the bar as well
 * would hear the same number twice.
 *
 * **It only exists where a target does.** A bar with nothing to be a fraction of
 * fills its own track by definition, drawing an identical picture for a trip
 * €300 under and one €3,000 over — decoration with the shape of information. Its
 * caller draws the number alone in that case.
 *
 * Under the target the track *is* the target and the fill is how much of it is
 * spoken for; over it the track is the spend and a red rule marks where the
 * target ran out. The arithmetic, and the reasoning, live in `lib/costScale`.
 *
 * It used to carry a second, hatched segment for what the front-runners would
 * add. That is gone with the rest of the projection: the bulk of the picture was
 * hypothetical, which made the part that had actually been decided the harder of
 * the two to read.
 *
 * `spend` and `target` must be in the same unit. A target is per person, so the
 * caller hands this per-person money — the mark and the sentence beneath it then
 * read the same figures and cannot disagree in front of the user.
 */
export function CostBar({ spend, target }: { spend: number; target: number }) {
  // `costScale` still speaks in committed-plus-extra, because it is shared, pure
  // and exhaustively tested in those terms. With no projection to add, the extra
  // is nothing and the locked money is the whole fill.
  const { committedPct, markerPct, againstTarget } = costScale({
    committed: spend,
    projected: spend,
    target,
  });

  return (
    <div
      className={"tally-bar" + (againstTarget ? t(" tally-bar--target") : "")}
      aria-hidden="true"
    >
      {committedPct > 0 ? (
        <div
          className="tally-bar__seg tally-bar__seg--committed"
          style={{ width: `${committedPct}%` }}
        />
      ) : null}
      {markerPct === null ? null : (
        <span className="tally-bar__limit" style={{ left: `${markerPct}%` }} />
      )}
    </div>
  );
}
