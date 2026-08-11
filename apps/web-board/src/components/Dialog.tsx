import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

/** Focusable descendants, in DOM order, skipping anything disabled or hidden. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "summary",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => {
      // Deliberately not `offsetParent`, the usual shorthand for "is visible":
      // it depends on layout, which jsdom does not do, so it reports every
      // control hidden under test and the trap would silently do nothing.
      if (el.closest("[hidden]") || el.closest('[aria-hidden="true"]')) {
        return false;
      }
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    },
  );
}

/**
 * The board's one modal shell (Phase 6.3).
 *
 * Every dialog on the board used to hand-roll this: its own backdrop, its own
 * `role="dialog" aria-modal="true"`, and its own Escape listener — nine copies,
 * none of which trapped focus. That made `aria-modal` a false promise: a Tab
 * from the last control walked straight out into the page behind, which a
 * screen-reader user has been told is inert. Closing then dropped focus on
 * `<body>`, so keyboard users restarted from the top of the document.
 *
 * This component owns all of it once:
 *  - the backdrop + the `board__dialog` card, with size modifiers,
 *  - `role="dialog"`, `aria-modal`, and a real accessible name — the heading is
 *    rendered here and wired via `aria-labelledby`, so the name can't drift
 *    from the visible title the way a duplicated `aria-label` can,
 *  - Escape to close (capture-phase safe: a popover Menu inside stops its own
 *    Escape from bubbling, so the inner layer closes first),
 *  - initial focus — the first focusable control, or an opt-in target,
 *  - a Tab/Shift+Tab **focus trap** that cycles within the dialog,
 *  - **focus restore** to whatever was focused when the dialog opened.
 *
 * Backdrop clicks deliberately do NOT dismiss: these dialogs hold half-typed
 * forms, and a stray click behind the card losing that work was a real
 * complaint (settled in the winner-polish pass and kept here).
 */
export function Dialog({
  title,
  eyebrow,
  onClose,
  children,
  size,
  initialFocusRef,
  describedById,
}: {
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode;
  /** Optional small label above the heading. */
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** `tall` scrolls a long list; `wide` is the two-column option form. */
  size?: "wide";
  /** Control to focus on open. Defaults to the first focusable in the dialog. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Id of an element describing the dialog, for `aria-describedby`. */
  describedById?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Captured once, before focus moves into the dialog, so it survives re-renders.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const card = cardRef.current;
    if (initialFocusRef?.current) initialFocusRef.current.focus();
    else if (card) (focusablesIn(card)[0] ?? card).focus();

    return () => {
      // Only take focus back if it is still inside the closing dialog —
      // an action that navigates away has already placed it deliberately.
      // `card` is the node captured above, not a cleanup-time ref read, which
      // React may already have nulled by the time this runs.
      const active = document.activeElement;
      const stillInside =
        active instanceof HTMLElement && (card?.contains(active) ?? false);
      if (
        (active === null || active === document.body || stillInside) &&
        returnFocusRef.current?.isConnected
      ) {
        returnFocusRef.current.focus();
      }
    };
    // Mount/unmount only: re-running would steal focus mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Cycle Tab within the dialog so focus can never reach the inert page. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const items = focusablesIn(card);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      // Nothing focusable inside: keep focus on the card rather than letting
      // Tab escape to the page the dialog is covering.
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === card)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="board__backdrop" role="presentation">
      <div
        ref={cardRef}
        className={"board__dialog" + (size ? ` board__dialog--${size}` : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {eyebrow ? <p className="board__eyebrow">{eyebrow}</p> : null}
        <h2 className="board__title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
