import { Link } from "react-router-dom";
import { t } from "../lib/i18n";

/** Which of the two views of a trip is on screen. */
export type TripView = "plan" | "timeline";

/**
 * Plan or Timeline — the switch between the two things that can fill the space
 * beside the rail.
 *
 * **Links, not buttons, and still two routes behind them.** The two views now
 * share a header, a title and a rail, so switching reads as the working surface
 * being replaced rather than as leaving for another page — which is the whole
 * point of the change. But making it component state would have cost three
 * things the split was paying for: the itinerary stops being linkable (it is the
 * one view worth sending someone), the browser's Back button stops undoing the
 * switch, and a History trip loses the read-only view of what it turned out to
 * be at the URL people already have. A segmented control that navigates keeps
 * the appearance of a mode and the behaviour of a page.
 *
 * `aria-current="page"` rather than a disabled link on the active side: the
 * current view is still a real destination, and a control that vanishes when you
 * reach it is how people lose track of where they are.
 */
export function ViewToggle({
  tripId,
  view,
}: {
  tripId: string;
  view: TripView;
}) {
  return (
    <nav className="viewtoggle" aria-label={t("Trip view")}>
      <Link
        className="viewtoggle__option"
        to={`/trips/${tripId}`}
        aria-current={view === "plan" ? "page" : undefined}
      >
        {t("Plan")}
      </Link>
      <Link
        className="viewtoggle__option"
        to={`/trips/${tripId}/timeline`}
        aria-current={view === "timeline" ? "page" : undefined}
      >
        {t("Timeline")}
      </Link>
    </nav>
  );
}
