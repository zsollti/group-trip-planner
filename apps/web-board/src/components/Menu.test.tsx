import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Menu } from "./Menu";

describe("Menu", () => {
  it("moves focus to the first item on open", () => {
    render(
      <Menu label="Card menu" items={[{ label: "Edit", onSelect: vi.fn() }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Card menu" }));
    // By role rather than by text: the label lives in a span inside the button
    // now, so it can have a consequence line under it, and `getByText` returns
    // the span rather than the thing that takes focus.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit" }),
    );
  });

  it("returns focus to its trigger when Escape closes it", () => {
    render(
      <Menu label="Card menu" items={[{ label: "Edit", onSelect: vi.fn() }]} />,
    );
    const trigger = screen.getByRole("button", { name: "Card menu" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    // Opening pushed focus into the list, so closing has to hand it back —
    // otherwise focus lands on <body> and keyboard users lose their place.
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  /*
   * The list is portalled to <body> so that a scrolling ancestor cannot clip
   * it. These two pin the halves of that which are easy to get wrong and do not
   * look like positioning bugs when they are.
   */
  it("draws its list outside the trigger's own box", () => {
    render(
      <Menu label="Card menu" items={[{ label: "Edit", onSelect: vi.fn() }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Card menu" }));

    const item = screen.getByRole("button", { name: "Edit" });
    const root = document.querySelector(".menu");
    expect(root).not.toBeNull();
    expect(root?.contains(item)).toBe(false);
    expect(document.body.contains(item)).toBe(true);
  });

  it("still fires an item that is no longer inside it", () => {
    const onSelect = vi.fn();
    render(<Menu label="Card menu" items={[{ label: "Edit", onSelect }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Card menu" }));

    // The mousedown is the trap: the outside-click watcher sees every one of
    // them, and a watcher that only knew about the trigger's subtree would read
    // this as a click outside and close the menu before the click landed.
    const item = screen.getByRole("button", { name: "Edit" });
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("returns focus to its trigger when a click outside closes it", () => {
    render(
      <Menu label="Card menu" items={[{ label: "Edit", onSelect: vi.fn() }]} />,
    );
    const trigger = screen.getByRole("button", { name: "Card menu" });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
