import { useEffect } from "react";
import { Button } from "@gtp/ui-primitives";
import { useTripActivity } from "@gtp/api-client";
import { activityHeadline, type ActivityAction } from "@gtp/types";

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
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, {
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
 */
export function ActivityDialog({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const activity = useTripActivity(tripId);

  // Escape closes, matching the other board dialogs (backdrop click does not).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const events = activity.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div className="board__backdrop" role="presentation">
      <div
        className="board__dialog board__dialog--tall"
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="board__eyebrow">History</p>
        <h2 className="board__title">Activity</h2>

        {activity.isPending ? (
          <p className="board__muted">Loading activity…</p>
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

        <div className="board__dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
