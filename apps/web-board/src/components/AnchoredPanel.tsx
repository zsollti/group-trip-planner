import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { anchorPanel } from "../lib/anchoredPosition";

/**
 * A popover that hangs off a trigger and is drawn over everything.
 *
 * **Why this exists.** Both of the board's popovers were `position: absolute`
 * inside the thing they belonged to, which means an ancestor with `overflow`
 * clips them: the crew strip scrolls sideways, so the panel that opens above a
 * member was cut off at the strip's edge, and the members list inside the crew
 * dialog scrolls, so a "⋯" menu opened near its bottom was cut off there. Both
 * were reported as "half of it is hidden", which is exactly what it is.
 *
 * ⚠️ `overflow-y: auto` clips *horizontally* too. There is no value of
 * `overflow` that scrolls one axis and lets the other overflow, so a panel
 * cannot be rescued by an `overflow-x: visible` on its container — this has
 * caught the board twice, and both times the fix was to stop being inside the
 * scroller at all.
 *
 * **A portal, therefore, and a portal costs something.** The panel is no longer
 * a DOM descendant of its trigger, so every "is the pointer/focus still inside
 * this control?" test has to consult both boxes. {@link holdsNode} answers that
 * for a trigger and a panel together, and callers must use it rather than
 * `root.contains` — the same care {@link Dialog} needs, and the
 * reason its own portal once unstyled every form control in the app (the
 * primitives were styled under a `.board` ancestor that no longer existed).
 * Nothing here relies on an ancestor: the panel keeps its own class, and the
 * classes involved are top-level.
 *
 * Position is measured in a layout effect, so the panel is placed before the
 * browser paints and there is no visible jump from its first position to its
 * real one. It is remeasured on scroll and resize, which is what keeps it stuck
 * to a trigger on a board that scrolls under it.
 */
export function AnchoredPanel({
  anchorRef,
  panelRef,
  place,
  align,
  gap,
  className,
  role,
  label,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  /** The trigger the panel hangs off. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The panel itself, so the caller can ask what is inside it. */
  panelRef: RefObject<HTMLDivElement | null>;
  place: "above" | "below";
  align: "left" | "right";
  gap?: number;
  className: string;
  role?: string;
  label?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place_() {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      setAt(
        anchorPanel(
          { top: a.top, left: a.left, width: a.width, height: a.height },
          { width: p.width, height: p.height },
          { width: window.innerWidth, height: window.innerHeight },
          { place, align, gap },
        ),
      );
    }
    place_();
    // Capture, because the scroller is usually an element between the trigger
    // and the window — a lane, the crew strip, a dialog's list — and a scroll
    // event on one of those does not bubble to the window.
    window.addEventListener("scroll", place_, true);
    window.addEventListener("resize", place_);
    return () => {
      window.removeEventListener("scroll", place_, true);
      window.removeEventListener("resize", place_);
    };
  }, [anchorRef, panelRef, place, align, gap]);

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      role={role}
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        // Before the first measurement the panel is placed at the trigger's own
        // corner rather than off screen: jsdom reports every box as zero, so a
        // parked-off-screen panel would be *invisible to tests* and a rule that
        // only holds in a real browser is a rule nothing here can check.
        top: at?.top ?? 0,
        left: at?.left ?? 0,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
