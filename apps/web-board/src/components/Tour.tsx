import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@gtp/ui-primitives";
import { ApiError, useAuth, useUpdateProfile } from "@gtp/api-client";
import {
  placeBubble,
  tourFinale,
  visibleSteps,
  type Placement,
  type TourKind,
  type TourStep,
} from "../lib/tour";
import { TourContext, useTour, type TourApi } from "../lib/useTour";
import { t } from "../lib/i18n";

/**
 * The guided tour: a bubble that points at the real thing it is describing.
 *
 * `lib/tour` holds the steps and the placement arithmetic and explains why the
 * tour is shaped this way at all. This file is the parts that need a document:
 * finding the anchors, following them when the page moves, and the keyboard.
 *
 * ## Three pieces
 *
 * `TourProvider` sits above the routes and owns "is a tour running".
 * {@link TourSteps} is what a route renders to say *which* steps apply to it —
 * so "Show me around" shows you around whatever you are looking at, rather than
 * needing to know where you are. {@link TourOverlay} is the bubble.
 *
 * ## Portalled, and that is not decoration
 *
 * The spotlight and the bubble are `position: fixed` and rendered into
 * `document.body`. A `transform` anywhere up the tree makes a fixed element
 * position against *that* element instead of the viewport — the board has one,
 * on the Plan/Timeline swap animation, and it is what once trapped every modal
 * inside the lane row. Anything positioned against the viewport has to leave
 * the tree that carries it.
 */

export function TourProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<readonly TourStep[]>([]);
  const [kind, setKind] = useState<TourKind>("board");
  const [running, setRunning] = useState(false);

  // Identity-stable, because `TourSteps` calls it from an effect: a new
  // function every render would re-offer on every render and, with `steps` in
  // that effect's own dependencies, never stop.
  const offer = useCallback((next: readonly TourStep[], nextKind: TourKind) => {
    setSteps((current) => (sameSteps(current, next) ? current : next));
    setKind(nextKind);
  }, []);

  const api = useMemo<TourApi>(
    () => ({
      offer,
      start: () => setRunning(true),
      available: steps.length > 0,
    }),
    [offer, steps.length],
  );

  return (
    <TourContext.Provider value={api}>
      {children}
      {running ? (
        <TourOverlay
          steps={steps}
          kind={kind}
          onClose={() => setRunning(false)}
        />
      ) : null}
    </TourContext.Provider>
  );
}

/** Two step lists are the same if they name the same steps in the same order. */
function sameSteps(a: readonly TourStep[], b: readonly TourStep[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]?.id);
}

/**
 * What a route renders to hand the tour its steps.
 *
 * Renders nothing. It exists so the provider does not have to know which routes
 * exist, and so the steps are declared beside the screen they describe.
 *
 * `autoStart` fires once per account, the first time they open a board — that
 * is what `tourCompletedAt` on the session is for, and why finishing *or*
 * skipping both set it. A tour that came back after being dismissed would be an
 * advert.
 */
export function TourSteps({
  steps,
  kind = "board",
  autoStart = false,
}: {
  steps: readonly TourStep[];
  /** Which tour these steps are — see {@link TourKind}. */
  kind?: TourKind;
  autoStart?: boolean;
}) {
  const { offer, start } = useTour();
  const { user } = useAuth();
  /*
   * Each tour is counted on its own mark.
   *
   * With one shared flag, the overview tour would finish, set it, and the board
   * tour would then never auto-start — so the app would break the promise the
   * overview's own last panel makes ("make a trip and I will show you around
   * the board itself") on the very next screen the reader opens.
   */
  const seen = Boolean(
    kind === "overview" ? user?.overviewTourCompletedAt : user?.tourCompletedAt,
  );
  /*
   * Set when the tour has actually **started**, not when one has been
   * scheduled — and that distinction is the whole of a bug this had.
   *
   * Flipping it before the timer meant StrictMode's deliberate
   * mount-unmount-remount in development cancelled the first timer through the
   * cleanup and then found the flag already set on the remount, so the tour
   * never opened at all. It reads like a race and is not one: it is a guard
   * placed against the wrong event.
   */
  const opened = useRef(false);

  useEffect(() => {
    offer(steps, kind);
  }, [offer, steps, kind]);

  useEffect(() => {
    if (!autoStart || seen || opened.current) return;
    /*
     * A beat before it opens, and it is not cosmetic.
     *
     * Every step is dropped when its anchor is missing, and on the first paint
     * of a board almost all of them are: the lanes, the crew and the cost panel
     * are each waiting on their own request. Starting immediately would run a
     * two-step tour of a board with eight things worth showing.
     */
    const id = window.setTimeout(() => {
      opened.current = true;
      start();
    }, 900);
    return () => window.clearTimeout(id);
  }, [autoStart, seen, start]);

  return null;
}

/** Find a step's anchor. One selector, defined in exactly one place. */
function anchorElement(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

const BUBBLE_WIDTH = 320;

function TourOverlay({
  steps,
  kind,
  onClose,
}: {
  steps: readonly TourStep[];
  kind: TourKind;
  onClose: () => void;
}) {
  const { applyUser } = useAuth();
  const update = useUpdateProfile();

  /*
   * The steps with something on screen to point at, settled **once** when the
   * tour opens.
   *
   * Re-deriving per step would let the list change underneath a reader who is
   * halfway through it — a lane finishing its fetch would grow the tour while
   * "3 of 6" was on screen. Settled at the start, the count is a promise.
   */
  const [live] = useState(() => visibleSteps(steps, (a) => !!anchorElement(a)));
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  // The last panel is the send-off, and it is a step of its own rather than a
  // line appended to the last real one: "here is the chat" and "off you go" are
  // different things to say, and running them together buries the second.
  const finale = tourFinale(kind);
  const total = live.length + 1;
  const step = live[index];
  const onFinale = index >= live.length;

  const finish = useCallback(() => {
    onClose();
    /*
     * Skipping and finishing are the same write, deliberately.
     *
     * The reader asked not to see it, and a tour that reappeared next time
     * would be an advert rather than an offer. It stays reachable from the
     * account menu, which is what "skippable but available later" means.
     *
     * Applied straight into the session so nothing has to refetch, and failures
     * are swallowed: the worst case is being offered the tour once more, which
     * is not worth an error message over a page the reader has just left.
     */
    update.mutate(
      kind === "overview"
        ? { overviewTourCompleted: true }
        : { tourCompleted: true },
      {
        onSuccess: applyUser,
        onError: (err) => {
          if (!(err instanceof ApiError)) throw err;
        },
      },
    );
  }, [applyUser, kind, onClose, update]);

  const next = useCallback(() => {
    if (onFinale) finish();
    else setIndex((i) => i + 1);
  }, [finish, onFinale]);

  /**
   * Follow the anchor.
   *
   * `useLayoutEffect` so the bubble is measured and positioned before the
   * browser paints — in an ordinary effect the first frame of every step draws
   * it at the previous step's coordinates, which reads as the panel sliding in
   * from wherever it happened to be.
   *
   * Re-run on scroll and resize because both move the anchor under a fixed
   * bubble, and neither is a React render.
   */
  useLayoutEffect(() => {
    if (onFinale) {
      setPlacement(null);
      setSpotlight(null);
      return;
    }
    const target = step ? anchorElement(step.anchor) : null;
    if (!target) return;

    const reposition = () => {
      const rect = target.getBoundingClientRect();
      const box = bubble.current?.getBoundingClientRect();
      setSpotlight(rect);
      setPlacement(
        placeBubble(
          rect,
          { width: BUBBLE_WIDTH, height: box?.height ?? 180 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    // Guarded because it is a convenience, not the feature: jsdom has no
    // `scrollIntoView` at all, and a tour that threw where it could not scroll
    // would take the whole board down with it.
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [step, onFinale]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Not translated, and never should be — these are `KeyboardEvent.key`
      // values, not words. Translating them breaks the keyboard.
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, next]);

  // Nothing on this page the tour can point at. Not an error and not worth a
  // message — it happens on a board still loading, and on one a Guest is
  // looking at where most of the steps are about things they cannot do.
  if (live.length === 0) return null;

  const title = onFinale ? finale.title : (step?.title ?? "");
  const body = onFinale ? finale.body : (step?.body ?? "");

  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-label={title}>
      {/*
       * The dimming, drawn as a huge shadow *around* a transparent box rather
       * than as four panels or a `clip-path`. One element, and the hole is
       * exactly the anchor's rectangle however it is shaped or scrolled.
       *
       * `pointer-events: none` throughout: the tour describes the app and must
       * not become a sheet of glass over it. A reader who wants to press the
       * thing being pointed at can.
       */}
      {spotlight ? (
        <div
          className="tour__spot"
          aria-hidden="true"
          style={{
            top: spotlight.top - 6,
            left: spotlight.left - 6,
            width: spotlight.width + 12,
            height: spotlight.height + 12,
          }}
        />
      ) : null}

      <div
        ref={bubble}
        className="tour__bubble"
        data-side={placement?.side ?? "center"}
        style={
          placement
            ? { top: placement.top, left: placement.left }
            : // The send-off belongs to no element, so it sits in the middle of
              // the screen rather than beside the last thing that was discussed.
              undefined
        }
      >
        <p className="tour__count">
          {t("{step} of {total}", { step: index + 1, total })}
        </p>
        <h2 className="tour__title">{title}</h2>
        <p className="tour__body">{body}</p>
        <div className="tour__actions">
          {/* Skip is always there, in the same place, and reads the same on
              every panel — a way out that moved or vanished would be worse
              than none. It is the quiet one; Next is the filled one. */}
          <button type="button" className="tour__skip" onClick={finish}>
            {onFinale ? t("Close") : t("Skip the tour")}
          </button>
          <span className="tour__spacer" />
          {index > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIndex((i) => i - 1)}
            >
              {t("Back")}
            </Button>
          ) : null}
          <Button type="button" variant="primary" onClick={next}>
            {onFinale ? t("Let's go") : t("Next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
