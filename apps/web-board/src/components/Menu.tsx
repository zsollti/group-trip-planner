import { useEffect, useRef, useState, type ReactNode } from "react";

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
}: {
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
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
                "menu__item" + (item.danger ? " menu__item--danger" : "")
              }
              disabled={item.disabled}
              aria-current={item.selected ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
              {item.badge ? (
                <span className="menu__badge" aria-label={`${item.badge} unread`}>
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
