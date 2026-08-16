import { useTripActivity } from "@gtp/api-client";
import { UI_LOCALE } from "../lib/locale";
import { activityHeadline, type ActivityAction } from "@gtp/types";
import { Dialog } from "./Dialog";

/** A glyph per action — a quick visual scan of what kind of event a line is. */
const ICON: Record<ActivityAction, string> = {
  OPTION_LOCKED: "🔒",
  OPTION_UNLOCKED: "🔓",
  MEMBER_ROLE_CHANGED: "⇅",
  MEMBER_KICKED: "⤫",
  MEMBER_BLOCKED: "⛔",
  MEMBER_UNBLOCKED: "↩",
  MEMBER_LEFT: "→",
  OWNERSHIP_TRANSFERRED: "👑",
};

/** Absolute date + time — a feed's whole job is saying *when*. */
function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(UI_LOCALE)} ${d.toLocaleTimeString(UI_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * The trip activity feed (Phase 5.4) — "what did I miss?".
 *
 * A read-only mirror of the audit log: locks and reopenings, role changes,
 * removals, blocks, departures, and ownership handovers, newest first, with the
 * actor and the time. Wording comes from the shared pure `activityHeadline`, so
 * the feed cannot describe an event differently than anything else would.
 *
 * Covers the four states — loading, error (with retry), genuinely empty, and
 * loaded — plus an explicit "Load older" rather than scroll-triggered paging,
 * which is both simpler and kinder to keyboard users.
 *
 * **No Close button of its own.** It had one, at the bottom, which is the worst
 * possible place for it here: this is the one dialog whose content grows
 * without limit, so on a busy trip the only way out sat below every event the
 * trip had ever recorded. The shell's own close sits in the corner and stays
 * there while the list scrolls under it.
 */
export function ActivityDialog({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const activity = useTripActivity(tripId);

  const events = activity.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <Dialog eyebrow="History" title="Activity" onClose={onClose}>
      <>
        {activity.isPending ? (
          <p className="board__muted" role="status">
            Loading activity…
          </p>
        ) : activity.isError ? (
          <>
            <p className="board__form-error" role="alert">
              Couldn't load this board's activity.
            </p>
            <button
              type="button"
              className="board__cta"
              onClick={() => void activity.refetch()}
            >
              Try again
            </button>
          </>
        ) : events.length === 0 ? (
          <p className="board__muted">
            Nothing has happened here yet. Locked decisions, role changes, and
            departures will show up on this list.
          </p>
        ) : (
          <>
            <ul className="board__activity">
              {events.map((event) => (
                <li key={event.id} className="board__activity-item">
                  <span className="board__activity-icon" aria-hidden="true">
                    {ICON[event.action]}
                  </span>
                  <span className="board__activity-text">
                    <span>{activityHeadline(event)}</span>
                    <time
                      className="board__activity-when"
                      dateTime={event.createdAt}
                    >
                      {when(event.createdAt)}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
            {activity.hasNextPage ? (
              <button
                type="button"
                className="board__link-btn"
                disabled={activity.isFetchingNextPage}
                onClick={() => void activity.fetchNextPage()}
              >
                {activity.isFetchingNextPage ? "Loading…" : "Load older"}
              </button>
            ) : null}
          </>
        )}

      </>
    </Dialog>
  );
}
