import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useNotifications } from "@gtp/api-client";
import { Menu } from "./Menu";
import { Avatar } from "./Avatar";
import { NotificationsDialog } from "./NotificationsDialog";
import { useTheme } from "../lib/theme";

/**
 * The account (avatar) menu (Phase 3.5) shown top-right on every page: the
 * light/dark toggle, Notifications, Settings, and Log out. Separated from the
 * trip-context actions so account controls stay consistent across the dashboard
 * and the board.
 *
 * **Notifications live here now.** They had their own bell in the header, which
 * made three separate triggers in the top-right corner of every page competing
 * for a glance. What is in this menu is the things that are about *you* rather
 * than about the trip in front of you, and a notification is one of those. The
 * cost of moving it is that a menu badge cannot be seen until the menu is open,
 * so the unread mark moved onto the avatar itself, which is always visible.
 *
 * **Delete account is not here.** It used to be, which meant every page that
 * drew this menu also had to mount {@link DeleteAccountDialog} and carry the
 * state to open it — four routes paying for a control that is used at most once
 * in an account's life, sitting one slip of the pointer away from "Log out". It
 * lives on the settings page now, under its own heading, where the rest of the
 * account lives.
 *
 * The trigger draws the caller's own {@link Avatar} — the same component the
 * chat and the crew list use. It used to hand-roll a single initial on the
 * accent colour, which predated avatars existing at all (Phase 6.2) and was
 * never migrated: the session has carried `avatarUrl` ever since, the upload
 * pushes the updated user straight into it, and this one trigger threw the
 * value away. So a picture appeared everywhere in the app *except* the header
 * of the page you set it from.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // The count the menu badges, and the reason the avatar carries a dot: with
  // the bell gone, this is the only thing left on screen that can say something
  // is waiting, and a menu badge is invisible until the menu is open.
  const notifications = useNotifications();
  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <>
    <Menu
      label={unread > 0 ? `Account menu, ${unread} unread` : "Account menu"}
      align="right"
      triggerClassName="board__avatar-trigger"
      trigger={
        <span className="board__avatar-wrap">
          <Avatar
            name={user?.displayName ?? "?"}
            userId={user?.id}
            url={user?.avatarUrl}
            size={30}
          />
          {unread > 0 ? (
            <span className="board__avatar-dot" aria-hidden="true" />
          ) : null}
        </span>
      }
      items={[
        {
          label: resolved === "dark" ? "☀ Light mode" : "☾ Dark mode",
          onSelect: toggle,
        },
        {
          label: "Notifications",
          onSelect: () => setNotificationsOpen(true),
          badge: unread,
        },
        {
          label: "Settings",
          onSelect: () => navigate("/settings"),
        },
        // Only for accounts this deployment names as operators, and only as a
        // convenience: hiding the link is not what protects the console. Every
        // /admin request is checked against the same configuration server-side,
        // so forcing this open reveals a page that answers 404 to everything.
        ...(user?.isAdmin
          ? [{ label: "⚙ Console", onSelect: () => navigate("/admin") }]
          : []),
        { label: "Log out", onSelect: () => void logout() },
      ]}
    />
    {notificationsOpen ? (
      <NotificationsDialog onClose={() => setNotificationsOpen(false)} />
    ) : null}
    </>
  );
}
