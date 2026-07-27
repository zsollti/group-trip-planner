import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Menu } from "./Menu";

describe("Menu", () => {
  it("moves focus to the first item on open", () => {
    render(
      <Menu label="Card menu" items={[{ label: "Edit", onSelect: vi.fn() }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Card menu" }));
    expect(document.activeElement).toBe(screen.getByText("Edit"));
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
