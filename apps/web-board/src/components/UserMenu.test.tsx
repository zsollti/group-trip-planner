import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@gtp/api-client";
import type { AuthUser } from "@gtp/types";
import { UserMenu } from "./UserMenu";

/**
 * The header avatar had no test, which is how it stayed wrong: the session has
 * carried `avatarUrl` since Phase 6.2 and this trigger threw it away, drawing a
 * single initial instead. A picture appeared everywhere in the app *except* the
 * header of the page you set it from.
 *
 * Both branches are pinned, because the fallback is the common case — most
 * accounts never upload anything.
 *
 * Notifications moved in here from their own header bell, which is why the menu
 * now needs a query client: the unread count is fetched, not passed. The mark
 * on the avatar is the part worth pinning — it is the only thing left on screen
 * that can say something is waiting, since a badge inside a closed menu says
 * nothing to anyone.
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({ user: mockUser, logout: vi.fn() }),
    useNotifications: () => ({
      data: { notifications: [], unreadCount: mockUnread },
    }),
  };
});

let mockUser: AuthUser | null = null;
let mockUnread = 0;

function renderMenu(user: AuthUser | null, unread = 0) {
  mockUser = user;
  mockUnread = unread;
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ada: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  emailVerified: true,
  avatarUrl: null,
  isAdmin: false,
  locale: "en",
  tourCompletedAt: null,
};

describe("UserMenu", () => {
  it("shows the account's picture when it has one", () => {
    const { container } = renderMenu({
      ...ada,
      avatarUrl: "https://api.example.com/media/ada.jpg",
    });
    const img = container.querySelector("img.avatar--image");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://api.example.com/media/ada.jpg");
  });

  it("falls back to initials when no picture is set", () => {
    const { container } = renderMenu(ada);
    expect(container.querySelector("img.avatar--image")).toBeNull();
    expect(container.querySelector(".avatar--initials")).not.toBeNull();
  });

  it("still opens the account menu", () => {
    // The trigger changed from a bare span to a component; the menu it opens
    // is the point of the control and must survive that.
    renderMenu(ada);
    expect(
      screen.getByRole("button", { name: /account menu/i }),
    ).toBeInTheDocument();
  });

  it("offers Settings, and no longer account deletion", () => {
    // Deletion used to sit here, which is why four routes each mounted a
    // deletion dialog. It lives on the settings page now; a stray re-add would
    // put an irreversible action one slip of the pointer from "Log out" again.
    renderMenu(ada);
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText(/delete account/i)).not.toBeInTheDocument();
  });

  it("offers Notifications under the theme toggle", () => {
    renderMenu(ada);
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    const theme = labels.findIndex((l) => /mode$/.test(l));
    const notifications = labels.findIndex((l) => /Notifications/.test(l));
    expect(notifications).toBe(theme + 1);
  });

  it("marks the avatar when something is unread, and only then", () => {
    // The count itself is in the menu; this dot is what says to open it. With
    // the bell gone there is nothing else on screen carrying that signal.
    const quiet = renderMenu(ada, 0);
    expect(quiet.container.querySelector(".board__avatar-dot")).toBeNull();
    quiet.unmount();

    const loud = renderMenu(ada, 3);
    expect(loud.container.querySelector(".board__avatar-dot")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /account menu, 3 unread/i }),
    ).toBeInTheDocument();
  });

  it("offers the console only to an operator", () => {
    // The link is a convenience, not a control: the API checks the same
    // configuration on every /admin request, so hiding it is about not
    // showing people a door they cannot open, and revealing it grants nothing.
    const plain = renderMenu(ada);
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByRole("button", { name: /console/i })).toBeNull();
    plain.unmount();

    renderMenu({ ...ada, isAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(
      screen.getByRole("button", { name: /console/i }),
    ).toBeInTheDocument();
  });
});
