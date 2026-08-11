import type { TripRole } from "@gtp/types";

/**
 * How a role is written for a reader.
 *
 * One definition, because it is now shown in two places that must agree: the
 * crew panel on the board and the management dialog behind it. A role that
 * reads "Co-organizer" in one and "CO_ORGANIZER" in the other is the kind of
 * seam that makes an app feel assembled rather than made.
 */
export const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};
