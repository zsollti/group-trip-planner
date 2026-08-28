import type { AssignableRole, InviteRole } from "@gtp/types";
import { EyeIcon, KeyIcon, PinIcon } from "./icons";

/**
 * The mark a role wears, wherever a role is drawn.
 *
 * One component because there were two, and they disagreed: the invite panel
 * offered a crown for Organizer and two figures for Traveler, while the crew
 * strip's quick actions offered a key and a pin for the same two roles. The
 * same person, described twice, looked like two different things.
 *
 * **The crown is the owner's, and only the owner's.** It is the mark on "Make
 * owner" in both the members dialog and the quick actions, so an Organizer
 * wearing one says that the trip has two of them. A key is the better picture
 * anyway: an Organizer is someone let in to the locks, not someone the trip
 * belongs to.
 *
 * A pin for a Traveler (they are on the map, going along) and an eye for a
 * Guest (they can see it, and that is all). Decoration in both places: the role
 * has its name in words beside it, so a screen reader hears "Organizer" rather
 * than "key, Organizer" — which is why there is no label here.
 */
export function RoleIcon({
  role,
  size = 15,
}: {
  role: AssignableRole | InviteRole;
  size?: number;
}) {
  switch (role) {
    case "CO_ORGANIZER":
      return <KeyIcon size={size} />;
    case "PARTICIPANT":
      return <PinIcon size={size} />;
    case "GUEST":
      return <EyeIcon size={size} />;
  }
}
