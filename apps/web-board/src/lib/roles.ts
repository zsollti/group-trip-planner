import type { AssignableRole, TripRole } from "@gtp/types";
import { t } from "./i18n";

/**
 * How a role is written for a reader.
 *
 * One definition, because it is now shown in two places that must agree: the
 * crew panel on the board and the management dialog behind it. A role that
 * reads "Co-organizer" in one and "CO_ORGANIZER" in the other is the kind of
 * seam that makes an app feel assembled rather than made.
 *
 * **A function, not the `Record` it used to be.** A map built at module scope
 * would call `t()` once, at import, and hold whichever language was active then —
 * so a reader who switched language would keep seeing the old role names while
 * the rest of the screen changed. Called per render, it is simply right.
 */
export function roleLabel(role: TripRole): string {
  switch (role) {
    case "OWNER":
      return t("Owner");
    case "CO_ORGANIZER":
      return t("Co-organizer");
    case "PARTICIPANT":
      return t("Participant");
    case "GUEST":
      return t("Guest");
  }
}

/**
 * "Give this person that role", as a menu item reads it.
 *
 * A whole sentence per role rather than `t("Make {role}", { role })`: Hungarian
 * inflects the role for this construction ("legyen társszervező"), and a frame
 * with a slot in it can only ever hold the dictionary form. The rule the app
 * follows everywhere — never assemble a sentence from translated fragments.
 *
 * Only the three assignable roles. Ownership is not granted this way; it is
 * transferred, with a confirmation, and there is exactly one owner.
 */
export function roleChangeLabel(role: AssignableRole): string {
  switch (role) {
    case "CO_ORGANIZER":
      return t("Make co-organizer");
    case "PARTICIPANT":
      return t("Make participant");
    case "GUEST":
      return t("Make guest");
  }
}
