import { t } from "./i18n";

/**
 * The guided tour, as data and arithmetic.
 *
 * **Why a coach-mark tour and not screenshots or a help page.** Screenshots go
 * stale silently — this app is read in two languages and its board has changed
 * in most of the last fifty pull requests, so a shot would need doubling and
 * would start lying within the week, with no test able to notice. A separate
 * help page is read *away* from the thing it describes, so the reader has to
 * hold it in their head and then go and find the buttons. A bubble pointing at
 * the live element cannot drift: when a control moves, the bubble moves with
 * it, because it is anchored to the control rather than to a picture of one.
 *
 * **Anchors are `data-tour` attributes, not class names or text.** A class is a
 * styling decision and gets renamed in a tidy-up; text is translated, so a
 * selector built on it works in English and finds nothing in Hungarian. The
 * attribute exists for exactly this and says so where it is written.
 *
 * **A step whose anchor is not on the page skips itself**, and that is the rule
 * the whole thing rests on. A Guest has no Invite button and no chat, an empty
 * board has no option card to vote on, a narrow window has no rail. Without
 * self-skipping every one of those strands the reader on a step that can never
 * advance — the failure that kills most hand-rolled tours.
 */
export interface TourStep {
  /** Stable id, for keys and for tests. Never shown. */
  readonly id: string;
  /** The `data-tour` value this step points at. */
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The board tour — the real one, because the board is where the app is.
 *
 * Ordered as a trip is actually planned rather than as the page is laid out:
 * a lane is a question, options are answers, the group votes, an organizer
 * locks one in, and only then is there any money or itinerary to look at.
 *
 * Built per call rather than held as a module constant: `t()` at module scope
 * runs once, at import, and would freeze these in whichever language the bundle
 * first loaded (see `lib/i18n`, and the test that scans for it).
 */
export function boardTourSteps(): readonly TourStep[] {
  return [
    {
      id: "lane",
      anchor: "lane",
      title: t("One lane, one question"),
      body: t(
        "Every column is something the group has to agree on: when to go, how to get there, where to sleep. Add as many as your trip needs.",
      ),
    },
    {
      id: "propose",
      anchor: "propose",
      title: t("Anyone can suggest something"),
      body: t(
        "Drop an idea into a lane with a price, a link and the dates it runs. You are not asking permission. You are putting it on the table.",
      ),
    },
    {
      id: "vote",
      anchor: "card",
      title: t("Everyone votes"),
      body: t(
        "Say what you think of each idea and see at a glance who agrees. When the group has made up its mind, an organizer locks the winner in and it stays at the top of its lane.",
      ),
    },
    {
      id: "cost",
      anchor: "cost",
      title: t("The money adds itself up"),
      body: t(
        "Every decision you lock in lands here, split per person. Give the trip a target and this will tell you where you stand against it.",
      ),
    },
    {
      id: "view",
      anchor: "view",
      title: t("Two ways to look at it"),
      body: t(
        "Plan is the board you have been looking at. Timeline lays the same decisions out day by day, so you can see what your trip actually looks like.",
      ),
    },
    {
      id: "crew",
      anchor: "crew",
      title: t("Who you're going with"),
      body: t(
        "Everyone on the trip, and what each of them can do. Organizers lock decisions in; travelers propose and vote.",
      ),
    },
    {
      id: "invite",
      anchor: "invite",
      title: t("Bring the others in"),
      body: t(
        "One link is all it takes, with no app for them to install. You choose what each link lets someone do.",
      ),
    },
    {
      id: "chat",
      anchor: "chat",
      title: t("Talk it over here"),
      body: t(
        "Every lane gets its own conversation, so the reason behind a decision stays next to the decision instead of scrolling away in a group chat.",
      ),
    },
  ];
}

/**
 * The overview tour: two steps, because an overview has two things on it.
 *
 * It exists so "Show me around" answers about whatever the reader is actually
 * looking at. Someone with no boards yet has nothing on the board tour to point
 * at, and sending them to a trip they have not created would be a strange
 * answer to a request for help.
 */
export function dashboardTourSteps(): readonly TourStep[] {
  return [
    {
      id: "boards",
      anchor: "new-board",
      title: t("A board is one trip"),
      body: t(
        "Start one here. The dates, the flights, the bill, the arguing: everything about that trip lives on its own board.",
      ),
    },
    {
      id: "account",
      anchor: "account",
      title: t("Everything else is in here"),
      body: t(
        "Your picture, the app's language, and this tour again whenever you want it.",
      ),
    },
  ];
}

/** The last panel's word, said once the reader has been through the lot. */
export function tourFinale(): { title: string; body: string } {
  return {
    title: t("Let the fun begin!"),
    body: t("That's the whole thing. Go and plan something."),
  };
}

/** Which side of its anchor a bubble ended up on. */
export type TourSide = "top" | "bottom" | "left" | "right";

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: TourSide;
}

/** How far the bubble sits from the thing it points at. */
export const TOUR_GAP = 12;

/**
 * Where to put the bubble, given what it points at and how much room there is.
 *
 * Pure, and separated from the component for the ordinary reason: this is the
 * part with the arithmetic and the edge cases, and jsdom cannot measure the
 * part that draws it. Everything here is in **viewport** coordinates, which is
 * what `getBoundingClientRect` returns and what a `position: fixed` bubble
 * wants — so no scroll offset is added anywhere, and none should be.
 *
 * Below first, because that is where a reader's eye already is after looking at
 * the thing the bubble is about, then above, then beside. The chosen side is
 * returned rather than inferred by the caller, so the little arrow can point
 * back the way the bubble came.
 *
 * The result is always clamped **into** the viewport, even when nothing fits —
 * a bubble half off the screen is the one outcome worse than a badly placed
 * one, since its buttons go with it and the tour cannot be advanced or left.
 */
export function placeBubble(
  anchor: Rect,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  gap: number = TOUR_GAP,
): Placement {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - bubble.height - gap;
  const right = anchor.left + anchor.width + gap;
  const left = anchor.left - bubble.width - gap;

  const side: TourSide =
    below + bubble.height <= viewport.height
      ? "bottom"
      : above >= 0
        ? "top"
        : right + bubble.width <= viewport.width
          ? "right"
          : left >= 0
            ? "left"
            : "bottom";

  const vertical =
    side === "bottom"
      ? below
      : side === "top"
        ? above
        : // Beside: centred on the anchor rather than aligned to its top, which
          // is what stops a bubble taller than a 28px avatar hanging off it.
          anchor.top + anchor.height / 2 - bubble.height / 2;

  const horizontal =
    side === "right"
      ? right
      : side === "left"
        ? left
        : anchor.left + anchor.width / 2 - bubble.width / 2;

  return {
    top: clamp(vertical, gap, viewport.height - bubble.height - gap),
    left: clamp(horizontal, gap, viewport.width - bubble.width - gap),
    side,
  };
}

/**
 * Keep a value inside a range that may be empty.
 *
 * `Math.min(max, Math.max(min, v))` on its own inverts when the bubble is
 * larger than the viewport — `max` goes below `min` and the value is pinned to
 * the *bottom* edge, pushing the panel's buttons off screen on a short phone.
 * Preferring `min` in that case keeps the top of the bubble visible, and its
 * top is where the words are.
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * The steps that have something on screen to point at.
 *
 * The whole self-skipping rule, as one function so it can be tested without a
 * browser: `present` answers "is there an element with this `data-tour`?", and
 * every step whose anchor is missing is dropped before the tour starts rather
 * than skipped over while it runs. Dropping up front is what makes "3 of 6"
 * honest — a count that included steps the reader will never see would be
 * counting down to the wrong number.
 */
export function visibleSteps(
  steps: readonly TourStep[],
  present: (anchor: string) => boolean,
): readonly TourStep[] {
  return steps.filter((step) => present(step.anchor));
}
