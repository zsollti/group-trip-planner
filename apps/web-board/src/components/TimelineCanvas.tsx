import { useMemo } from "react";
import { useCategoriesOptions } from "@gtp/api-client";
import type { CategoryView, TripDateRange } from "@gtp/types";
import { TimelineBoard } from "./TimelineBoard";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  buildTimeline,
  timelineCandidates,
  useTimelineProposals,
} from "../lib/timeline";
import { plural, t } from "../lib/i18n";

/**
 * The trip's itinerary: what was decided, laid out on the calendar it will
 * actually happen on.
 *
 * This was its own route with its own header and its own title. It is now the
 * other thing that can fill the space beside {@link BoardRail} — the Timeline
 * half of the Plan/Timeline switch — so everything that was about *the trip*
 * rather than about the itinerary moved up to the route, and what is left here
 * is the view itself.
 *
 * Still read-only by construction. Every mutation stays on the board; the cards
 * here open the same detail dialog and nothing else, so there is no permission
 * branch to get wrong — which is also why this takes no role.
 */
export function TimelineCanvas({
  tripId,
  categories,
  tripDates,
}: {
  tripId: string;
  categories: CategoryView[];
  /** The trip's settled range, or null while the dates are still a question. */
  tripDates: TripDateRange | null;
}) {
  const catIds = useMemo(() => categories.map((c) => c.id), [categories]);
  const opts = useCategoriesOptions(tripId, catIds);
  const [showProposals, setShowProposals] = useTimelineProposals();

  const timeline = useMemo(
    () =>
      buildTimeline(
        timelineCandidates(categories, opts.byCategory, {
          includeProposed: showProposals,
        }),
        tripDates,
      ),
    [categories, opts.byCategory, tripDates, showProposals],
  );

  const notPlaced = timeline.unscheduled.length + timeline.elsewhere.length;

  return (
    <div className="board__timeline">
      {/* The count stays with the thing it counts. It used to live in the line
          under the trip's name, back when this was a page of its own; up there
          now it would be a fact about the itinerary sitting in the trip's
          heading, still on screen while the reader is looking at the lanes. */}
      <p className="board__muted tl__summary">
        {plural(
          timeline.placedCount,
          "{n} decision placed",
          "{n} decisions placed",
        )}
        {notPlaced > 0 ? t(" · {n} not scheduled", { n: notPlaced }) : ""}
      </p>

      {/* An overlay rather than a second mode: the itinerary stays what this
          is, and this layers the candidates under it for spotting a clash. */}
      <div className="tl__controls">
        <ToggleSwitch
          checked={showProposals}
          onChange={setShowProposals}
          label={t("Show proposals")}
          description={t(
            "Draw the options still being decided, under the ones that are settled.",
          )}
        />
      </div>

      {opts.isPending ? (
        <p className="board__muted" role="status">
          {t("Loading decisions…")}
        </p>
      ) : opts.isError ? (
        <p className="board__form-error" role="alert">
          {t(
            "Couldn't load the trip's decisions. Reload the page to try again.",
          )}
        </p>
      ) : (
        <TimelineBoard timeline={timeline} tripDates={tripDates} />
      )}
    </div>
  );
}
