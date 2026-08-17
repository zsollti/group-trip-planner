import type { TripRole } from "@gtp/types";
import { CostTally } from "./CostTally";
import { CrewPanel } from "./CrewPanel";

/**
 * What the trip costs, and who is on it — the two things the working surface
 * beside them cannot tell you by being read.
 *
 * Lifted out of {@link BoardCanvas}, which used to own it. The board is no
 * longer the only thing that stands next to it: Plan and Timeline are two views
 * of one trip, and the rail is reference material for both. Leaving it inside
 * the canvas would have meant either duplicating it for the itinerary or having
 * it vanish when the reader switched view — and money and crew do not stop being
 * true when you look at the calendar.
 *
 * A column rather than a band across the top: both are things you consult
 * *while* working, and a band pushed the work itself below the fold on a laptop.
 */
export function BoardRail({
  tripId,
  myRole,
  myUserId,
  onManageMembers,
  onInviteMembers,
}: {
  tripId: string;
  myRole: TripRole;
  myUserId: string | undefined;
  /** Open the members dialog — the route owns it, so nothing can open two. */
  onManageMembers: () => void;
  /** Open the invite dialog, owned by the route for the same reason. */
  onInviteMembers: () => void;
}) {
  return (
    <aside className="board__rail">
      <CostTally tripId={tripId} myUserId={myUserId} />
      <CrewPanel
        tripId={tripId}
        myRole={myRole}
        myUserId={myUserId}
        onManage={onManageMembers}
        onInvite={onInviteMembers}
      />
    </aside>
  );
}
