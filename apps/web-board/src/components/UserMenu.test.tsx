import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return { ...actual, useAuth: () => ({ user: mockUser, logout: vi.fn() }) };
});

let mockUser: AuthUser | null = null;

function renderMenu(user: AuthUser | null) {
  mockUser = user;
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

const ada: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  emailVerified: true,
  avatarUrl: null,
  isAdmin: false,
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
