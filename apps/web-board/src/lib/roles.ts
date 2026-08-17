import type { TripRole } from "@gtp/types";
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
