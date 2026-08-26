import { ROLE_RANK, type TripRole } from "@gtp/types";
import { t } from "./i18n";

/**
 * How a role is written for a reader.
 *
 * One definition, because it is shown in four places that must agree: the crew
 * panel, the management dialog behind it, the invite dialog's role picker, and
 * the badge on each tile of the boards overview. A role that reads
 * "Co-organizer" in one and "CO_ORGANIZER" in another is the kind of seam that
 * makes an app feel assembled rather than made.
 *
 * **Owner and Co-organizer both read "Organizer" (post-launch), on purpose.**
 * The two are genuinely different to the *server* — an Owner can transfer the
 * board, delete it, and act on a Co-organizer, none of which run the other way
 * — but that difference is about what happens if somebody tries something, and
 * the crew list is not where anyone learns it. What a reader wants from a name
 * beside a face is "can this person lock a decision", and to that question the
 * two roles give the same answer. So the vocabulary is the group's: an
 * **Organizer** runs the trip, a **Traveler** is coming on it, and a **Guest**
 * is looking.
 *
 * The distinction is not lost anywhere it matters. `ROLE_RANK` still ranks
 * them, `canActOn` still refuses a Co-organizer acting on the Owner, and the
 * member dialog still cannot offer Owner as a role to assign — because
 * ownership moves by transfer and never by a `<select>`. Which is also why two
 * options never collide in a picker: no picker in this app contains OWNER.
 *
 * **A function, not the `Record` it used to be.** A map built at module scope
 * would call `t()` once, at import, and hold whichever language was active then
 * — so a reader who switched language would keep seeing the old role names
 * while the rest of the screen changed. Called per render, it is simply right.
 */
export function roleLabel(role: TripRole): string {
  switch (role) {
    case "OWNER":
    case "CO_ORGANIZER":
      return t("Organizer");
    case "PARTICIPANT":
      return t("Traveler");
    case "GUEST":
      return t("Guest");
  }
}

/**
 * What a role may actually do, in a sentence a person would say.
 *
 * For the invite dialog, where the whole question is "which of these am I
 * handing this person?" — and where the answer used to be three words in a
 * `<select>` with nothing to choose between them. Deliberately not a permission
 * matrix in prose: it names the one thing that distinguishes this role from the
 * one below it and stops, because a reader picking an invite link is deciding
 * how much they trust somebody, not auditing an ACL.
 *
 * **It reads as the second half of "Organizer: …", and is written that way.**
 * Lower case, no repeated subject, and no colon of its own — these used to open
 * with a clause and a colon ("Runs the trip with you: can add lanes…"), which
 * was right when the name sat on a line above and wrong now the two are one
 * sentence. Two colons in a row is a line nobody can parse.
 */
export function roleBlurb(role: TripRole): string {
  switch (role) {
    case "OWNER":
    case "CO_ORGANIZER":
      return t(
        "runs the trip with you, adding lanes, inviting people and locking in decisions.",
      );
    case "PARTICIPANT":
      return t(
        "comes along, suggesting options, voting on everything and joining the chat.",
      );
    case "GUEST":
      return t("just looks, and can do nothing else.");
  }
}

/**
 * Order a crew list the way it is read: organizers, then travelers, then
 * guests.
 *
 * The list arrived in whatever order the server returned — join order, in
 * practice — so the person who can actually lock a decision could be anywhere
 * in it, and the panel's one job is to answer "who do I ask?". Sorted by
 * `ROLE_RANK` so the ranking is the same fact the permission engine uses rather
 * than a second list that could drift from it.
 *
 * **Stable within a role**, which is what keeps the Owner above the
 * Co-organizers even though both read "Organizer": `sort` preserves the
 * incoming order between equal keys, and the ranks are not equal here even
 * where the labels are.
 */
export function byRole<T extends { role: TripRole }>(
  members: readonly T[],
): T[] {
  return [...members].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
}
