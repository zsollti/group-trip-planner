import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  can,
  canActOn,
  type AssignableRole,
  type TripMemberView,
  type TripRole,
} from "@gtp/types";
import { roleLabel } from "../lib/roles";
import { type useMemberActions } from "../lib/memberActions";
import {
  BanIcon,
  CrownIcon,
  ExitIcon,
  EyeIcon,
  KeyIcon,
  PinIcon,
} from "./icons";
import { t } from "../lib/i18n";

/** The mark each assignable role wears, and the order they are offered in —
 *  most capable first, the way the crew list itself is sorted. */
const ROLE_ICON: Record<AssignableRole, () => ReactNode> = {
  CO_ORGANIZER: () => <KeyIcon size={15} />,
  PARTICIPANT: () => <PinIcon size={15} />,
  GUEST: () => <EyeIcon size={15} />,
};

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
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
      onMouseLeave={() => setOpen(false)}
      // Closes when focus leaves the row *and* the panel — which is one subtree,
      // so `relatedTarget` staying inside it is exactly the case to ignore.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
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
        <div
          className="crew__quick"
          role="group"
          aria-label={t("Actions for {name}", { name: member.displayName })}
        >
          {actions.assignableRoles.map((role) =>
            button(
              t("Set {name} as {role}", {
                name: member.displayName,
                role: roleLabel(role),
              }),
              ROLE_ICON[role](),
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
        </div>
      ) : null}
    </div>
  );
}
