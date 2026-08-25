import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { t } from "../lib/i18n";

/** One action in a {@link Menu}. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A count to show alongside the label — unread messages on a collapsed chat
   *  channel, say. Omitted or 0 renders nothing. */
  badge?: number;
  /** Marks the item as the one currently in effect (the open channel). */
  selected?: boolean;
  /**
   * A line under the label saying what the item will actually do.
   *
   * For the few actions whose name is not enough on its own. "Remove" and
   * "Block" are the case that asked for it: both take someone off a trip, the
   * difference between them is whether they can come back, and no verb pair
   * carries that difference to a reader who has not met it before. Kept out of
   * the accessible name — the button is still "Remove and block" — and wired as
   * its description instead, so a screen reader hears the label first and the
   * consequence after, in that order.
   */
  note?: string;
  /**
   * Draw a rule above this item, breaking the list into groups.
   *
   * A flag on the item rather than a separator entry in the list, because the
   * list is `items.map` keyed by label and rendered as buttons — a separator
   * "item" would need a label it doesn't have, and would have to be skipped by
   * the focus-first logic. This is the same list, spaced.
   */
  separated?: boolean;
}

/**
 * A small accessible popover menu (Phase 3.5) — the shared "⋯" pattern behind the
 * card actions, the lane actions, the trip menu, and the avatar menu. It is a
 * button-triggered popover of plain buttons (not an ARIA menu widget, so there's
 * no half-implemented arrow-key contract): the trigger advertises the popover
 * (`aria-haspopup`/`aria-expanded`), focus moves to the first item on open, and it
 * closes on Escape, on outside click, or after an item fires. Items Tab normally.
 */
export function Menu({
  label,
  items,
  trigger,
  align = "right",
  triggerClassName,
  tourAnchor,
}: {
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  /** `data-tour` value for the trigger, when the guided tour points at it. */
  tourAnchor?: string;
}) {
  const [open, setOpen] = useState(false);
  // Namespaces the note ids, since several of these can be open on one page.
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    // Captured for the cleanup below: reading a ref there is unreliable, since
    // React may have detached it by the time the cleanup runs.
    const root = rootRef.current;
    const trigger = triggerRef.current;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      // Hand focus back to the trigger on close. Opening moved focus into the
      // list, so without this an Escape or an outside click drops focus onto
      // <body> and a keyboard user restarts from the top of the document.
      // Selecting an item is the exception — it may open a dialog, which claims
      // focus itself; that runs after this, so the dialog still wins.
      const active = document.activeElement;
      if (
        active === null ||
        active === document.body ||
        (active instanceof HTMLElement && (root?.contains(active) ?? false))
      ) {
        trigger?.focus();
      }
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          "menu__trigger" + (triggerClassName ? ` ${triggerClassName}` : "")
        }
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        data-tour={tourAnchor}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? "⋯"}
      </button>
      {open ? (
        <div
          className={
            "menu__list" + (align === "left" ? " menu__list--left" : "")
          }
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={i === 0 ? firstItemRef : undefined}
              type="button"
              className={
                "menu__item" +
                (item.danger ? " menu__item--danger" : "") +
                (item.separated ? " menu__item--separated" : "") +
                (item.note ? " menu__item--noted" : "")
              }
              disabled={item.disabled}
              aria-current={item.selected ? "true" : undefined}
              aria-describedby={item.note ? `${id}-note-${i}` : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span className="menu__item-label">
                {item.label}
                {item.badge ? (
                  <span
                    className="menu__badge"
                    aria-label={t("{n} unread", { n: item.badge })}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </span>
              {item.note ? (
                <span className="menu__note" id={`${id}-note-${i}`}>
                  {item.note}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
