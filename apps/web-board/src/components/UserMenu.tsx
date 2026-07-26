import { useNavigate } from "react-router-dom";
import { useAuth } from "@gtp/api-client";
import { Menu } from "./Menu";
import { useTheme } from "../lib/theme";

/**
 * The account (avatar) menu (Phase 3.5) shown top-right on every page: the
 * light/dark toggle, notification settings (5.3), Log out, and Delete account.
 * Separated from the trip-context actions so account controls stay consistent
 * across the dashboard and the board.
 */
export function UserMenu({ onDeleteAccount }: { onDeleteAccount: () => void }) {
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  const initial = user?.displayName?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <Menu
      label="Account menu"
      align="right"
      triggerClassName="board__avatar-trigger"
      trigger={
        <span className="board__avatar" aria-hidden="true">
          {initial}
        </span>
      }
      items={[
        {
          label: resolved === "dark" ? "☀ Light mode" : "☾ Dark mode",
          onSelect: toggle,
        },
        {
          label: "Notification settings",
          onSelect: () => navigate("/settings"),
        },
        { label: "Log out", onSelect: () => void logout() },
        { label: "Delete account", onSelect: onDeleteAccount, danger: true },
      ]}
    />
  );
}
