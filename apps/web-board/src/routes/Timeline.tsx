import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useCategoriesOptions,
  useTrip,
  useTripCategories,
} from "@gtp/api-client";
import { tripDateRange } from "@gtp/types";
import { TimelineBoard } from "../components/TimelineBoard";
import { UserMenu } from "../components/UserMenu";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import {
  buildTimeline,
  timelineCandidates,
  useTimelineProposals,
} from "../lib/timeline";
import { tripDateForDisplay } from "../lib/tripDate";
import { ToggleSwitch } from "../components/ToggleSwitch";

/** A trip date, rendered from the calendar day it names rather than its instant. */
function fmtTripDate(iso: string | null): string {
  const d = tripDateForDisplay(iso);
  return d
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";
}

/**
 * The trip's itinerary (`/trips/:id/timeline`).
 *
 * Its own route rather than a mode on the board, because it answers a different
 * question with a different frame: the board is where a trip is *decided*, and
 * this is what was decided, laid out on the calendar it will actually happen
 * on. That also makes it linkable, and leaves it working on a History trip —
 * where a read-only view of what the trip turned out to be is arguably the most
 * valuable thing on the site.
 *
 * Read-only by construction. Every mutation stays on the board; the cards here
 * open the same detail dialog and nothing else, so there is no permission
 * branch to get wrong.
 */
export function Timeline() {
  const { id } = useParams<{ id: string }>();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const trip = useTrip(id);
  const categories = useTripCategories(id);
  const catIds = useMemo(
    () => (categories.data ?? []).map((c) => c.id),
    [categories.data],
  );
  const opts = useCategoriesOptions(id ?? "", catIds);
  const [showProposals, setShowProposals] = useTimelineProposals();

  const tripDates = trip.data ? tripDateRange(trip.data) : null;
  const timeline = useMemo(
    () =>
      buildTimeline(
        timelineCandidates(categories.data ?? [], opts.byCategory, {
          includeProposed: showProposals,
        }),
        tripDates,
      ),
    [categories.data, opts.byCategory, tripDates, showProposals],
  );

  const notPlaced = timeline.unscheduled.length + timeline.elsewhere.length;

  return (
    <main className="board board--measure">
      <header className="board__bar">
        <Link
          className="board__brand board__brand--link"
          to={id ? `/trips/${id}` : "/"}
        >
          ‹ Board
        </Link>
        <div className="board__bar-actions">
          <UserMenu onDeleteAccount={() => setDeleteAccountOpen(true)} />
        </div>
      </header>

      {deleteAccountOpen ? (
        <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
      ) : null}

      {trip.isPending || categories.isPending ? (
        <p className="board__muted">Loading timeline…</p>
      ) : trip.isError ? (
        <>
          <p className="board__form-error" role="alert">
            {trip.error.status === 404
              ? "That board doesn't exist or you're not a member."
              : "Couldn't load this board."}
          </p>
          <Link className="board__cta" to="/">
            Back to boards
          </Link>
        </>
      ) : categories.isError ? (
        <p className="board__form-error" role="alert">
          Couldn't load the category lanes.
        </p>
      ) : (
        /* The measure lives on `.board--measure` above, shared with the other
           reading surfaces — it began here as a timeline-private idea, which is
           exactly why the page looked like an accident next to the rest. */
        <>
          <p className="board__eyebrow">Timeline</p>
          <h1 className="board__title">{trip.data.name}</h1>
          <p className="board__muted">
            {tripDates ? (
              <>
                {fmtTripDate(trip.data.startDate)} –{" "}
                {fmtTripDate(trip.data.endDate)} ·{" "}
              </>
            ) : (
              <>Dates not settled · </>
            )}
            {timeline.placedCount} decision
            {timeline.placedCount === 1 ? "" : "s"} placed
            {notPlaced > 0 ? ` · ${notPlaced} not scheduled` : ""}
          </p>

          {/* An overlay rather than a second mode: the itinerary stays what
              the page is, and this layers the candidates under it for spotting
              a clash. */}
          <div className="tl__controls">
            <ToggleSwitch
              checked={showProposals}
              onChange={setShowProposals}
              label="Show proposals"
              description="Draw the options still being decided, under the ones that are settled."
            />
          </div>

          {opts.isPending ? (
            <p className="board__muted" role="status">
              Loading decisions…
            </p>
          ) : opts.isError ? (
            <p className="board__form-error" role="alert">
              Couldn't load the trip's decisions. Reload the page to try again.
            </p>
          ) : (
            <TimelineBoard timeline={timeline} tripDates={tripDates} />
          )}
        </>
      )}
    </main>
  );
}
