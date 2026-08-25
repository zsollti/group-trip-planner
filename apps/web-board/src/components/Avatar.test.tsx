import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { avatarPresetUrl } from "@gtp/types";
import { Avatar } from "./Avatar";

/**
 * Which of the three avatars gets drawn.
 *
 * One column carries an uploaded picture and a drawn mark, so the order the
 * branches are tested in is load-bearing: an `<img src="preset:tent">` is a
 * broken image, not a fallback, and that is exactly what a preset check placed
 * after the image branch produces.
 */
describe("Avatar", () => {
  it("draws a mark rather than loading it as an address", () => {
    const { container } = render(
      <Avatar name="Ada Lovelace" userId="u1" url={avatarPresetUrl("tent")} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".avatar--preset")).not.toBeNull();
  });

  it("still loads a real picture", () => {
    const { container } = render(
      <Avatar name="Ada" userId="u1" url="https://example.test/a.webp" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/a.webp",
    );
  });

  it("falls back to initials with no avatar, and on a mark it cannot draw", () => {
    const { container, rerender } = render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByTitle("Ada Lovelace")).toHaveTextContent("AL");

    rerender(<Avatar name="Ada Lovelace" url="preset:hovercraft" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTitle("Ada Lovelace")).toHaveTextContent("AL");
  });

  it("gives a mark the same colour as the initials it replaces", () => {
    // The whole point of a generated hue is that one person keeps one colour;
    // choosing a tent must not change who they look like.
    const initials = render(<Avatar name="Ada" userId="u1" />);
    const hue = initials.container
      .querySelector<HTMLElement>(".avatar")
      ?.style.getPropertyValue("--avatar-hue");
    initials.unmount();

    const mark = render(
      <Avatar name="Ada" userId="u1" url={avatarPresetUrl("compass")} />,
    );
    expect(
      mark.container
        .querySelector<HTMLElement>(".avatar")
        ?.style.getPropertyValue("--avatar-hue"),
    ).toBe(hue);
    expect(hue).toBeTruthy();
  });
});
