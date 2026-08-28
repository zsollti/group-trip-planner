import { useEffect, useRef, useState, type ReactNode } from "react";
import { can, canActOn, type TripMemberView, type TripRole } from "@gtp/types";
import { AnchoredPanel } from "./AnchoredPanel";
import { holdsNode } from "../lib/anchoredPosition";
import { roleLabel } from "../lib/roles";
import { type useMemberActions } from "../lib/memberActions";
import { BanIcon, CrownIcon, ExitIcon } from "./icons";
import { RoleIcon } from "./RoleIcon";
import { t } from "../lib/i18n";

/**
 * What an organizer can do to one person, where that person is.
 *
 * The crew strip was read-only on purpose, and the purpose still holds for its
 * *resting* state: a role `<select>` on a band you scan past would make the
 * board's most consequential controls its most ambient ones. This is the other
 * shape of the same care — nothing is on the row until you go to that row, and
 * then everything is, in one place, next to the name it applies to. The members
 * dialog is unchanged and still the way to work through a list; this is the way
 * to fix one person's role without opening anything.
 *
 * **Not hover-only.** The panel opens on hover because that is the gesture that
 * costs nothing on a desktop, and on click because hover does not exist on a
 * phone and cannot be reached by a keyboard. The same button serves both, so
 * there is no second affordance that only some readers get.
 *
 * **Icons, with their names on them.** Six words on a strip would turn a list of
 * people into a toolbar; six unexplained pictures would be a puzzle. Every
 * button carries its full label on `title` and `aria-label` — so a pointer gets
 * a tooltip, a screen reader gets a sentence, and the strip stays a list.
 *
 * The three irreversible acts do not fire from here. They stage a confirm the
 * caller renders, the same one the dialog uses ({@link useMemberActions}) —
 * "remove" and "remove and block" differ only in what happens afterwards, and
 * an icon cannot carry that difference on its own.
 */
export function MemberQuickActions({
  member,
  isSelf,
  myRole,
  actions,
  children,
}: {
  member: TripMemberView;
  isSelf: boolean;
  myRole: TripRole;
  actions: ReturnType<typeof useMemberActions>;
  /** The row itself — avatar, name, role — which doubles as the trigger. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /* The panel is portalled out of the row (see {@link AnchoredPanel}), so it is
   * not a descendant of `rootRef` any more and the pointer leaving the row is
   * no longer the same event as the pointer leaving the control. */
  const panelRef = useRef<HTMLDivElement>(null);

  // Strictly-lower rank, the same rule the dialog applies: a co-organizer gets
  // no controls on the owner or on a peer, and nobody gets them on themselves.
  const manageable =
    can(myRole, "member.manage") && !isSelf && canActOn(myRole, member.role);
  const canTransfer = can(myRole, "trip.transferOwnership");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    /*
     * Hover-out, tracked on the document rather than with `onMouseLeave` on the
     * row.
     *
     * The row and the panel are two separate subtrees once the panel is
     * portalled, so leaving the row *is* leaving its element — a mouseleave
     * handler there would close the panel at the moment the pointer set off
     * towards it. Asking "is the pointer over either box?" is the same question
     * the old handler was asking, phrased so that a portal cannot change the
     * answer. `pointerover` rather than `pointermove` because it fires once per
     * element crossed rather than once per pixel.
     */
    const onOver = (e: Event) => {
      if (!holdsNode(e.target as Node, rootRef.current, panelRef.current)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", onOver);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerover", onOver);
    };
  }, [open]);

  if (!manageable) return <>{children}</>;

  function act(kind: "kick" | "block" | "transfer") {
    setOpen(false);
    actions.ask(kind, member);
  }

  const button = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    extra?: { current?: boolean; danger?: boolean },
  ) => (
    <button
      key={label}
      type="button"
      className={
        "crew__quick-btn" + (extra?.danger ? " crew__quick-btn--danger" : "")
      }
      // The word, in both the places a word can go: a tooltip for a pointer and
      // an accessible name for everyone else. Never rendered on the button —
      // that is the whole reason these are icons.
      title={label}
      aria-label={label}
      aria-current={extra?.current ? "true" : undefined}
      disabled={extra?.current || actions.busy}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="crew__member-wrap"
      onMouseEnter={() => setOpen(true)}
      // Closes when focus leaves the row *and* the panel — two subtrees since
      // the panel is portalled, so both are asked.
      onBlur={(e) => {
        if (
          !holdsNode(
            e.relatedTarget as Node | null,
            rootRef.current,
            panelRef.current,
          )
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="crew__member-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("Actions for {name}", { name: member.displayName })}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open ? (
        <AnchoredPanel
          anchorRef={rootRef}
          panelRef={panelRef}
          place="above"
          align="left"
          className="crew__quick"
          role="group"
          label={t("Actions for {name}", { name: member.displayName })}
          // Focus can move into the panel, and a blur inside it must not close
          // the control it is inside.
          onMouseEnter={() => setOpen(true)}
        >
          {actions.assignableRoles.map((role) =>
            button(
              t("Set {name} as {role}", {
                name: member.displayName,
                role: roleLabel(role),
              }),
              <RoleIcon role={role} />,
              () => actions.setRole(member, role),
              { current: role === member.role },
            ),
          )}
          <span className="crew__quick-rule" aria-hidden="true" />
          {canTransfer
            ? button(
                t("Make {name} the owner", { name: member.displayName }),
                <CrownIcon size={15} />,
                () => act("transfer"),
                { danger: true },
              )
            : null}
          {button(
            t("Remove {name} from the trip", { name: member.displayName }),
            <ExitIcon size={15} />,
            () => act("kick"),
            { danger: true },
          )}
          {button(
            t("Remove {name} and block them from rejoining", {
              name: member.displayName,
            }),
            <BanIcon size={15} />,
            () => act("block"),
            { danger: true },
          )}
        </AnchoredPanel>
      ) : null}
    </div>
  );
}
