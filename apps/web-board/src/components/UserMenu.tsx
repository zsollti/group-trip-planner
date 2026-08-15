import { useNavigate } from "react-router-dom";
import { useAuth } from "@gtp/api-client";
import { Menu } from "./Menu";
import { Avatar } from "./Avatar";
import { useTheme } from "../lib/theme";

/**
 * The account (avatar) menu (Phase 3.5) shown top-right on every page: the
 * light/dark toggle, Settings, and Log out. Separated from the trip-context
 * actions so account controls stay consistent across the dashboard and the
 * board.
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

  return (
    <Menu
      label="Account menu"
      align="right"
      triggerClassName="board__avatar-trigger"
      trigger={
        <Avatar
          name={user?.displayName ?? "?"}
          userId={user?.id}
          url={user?.avatarUrl}
          size={30}
        />
      }
      items={[
        {
          label: resolved === "dark" ? "☀ Light mode" : "☾ Dark mode",
          onSelect: toggle,
        },
        {
          label: "Settings",
          onSelect: () => navigate("/settings"),
        },
        { label: "Log out", onSelect: () => void logout() },
      ]}
    />
  );
}
