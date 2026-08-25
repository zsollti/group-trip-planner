import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { avatarPresetUrl } from "@gtp/types";
import { AvatarPresetPicker } from "./AvatarPresetPicker";

/**
 * Two strips, and the one thing that can go wrong between them.
 *
 * A drawn avatar is a mark *and* a colour, but only the mark is required — so
 * the interesting cases are all about what a colour tap does depending on
 * whether there is a mark to put it on. Getting that wrong in the generous
 * direction is the expensive one: a reader wearing a photograph who taps a
 * swatch to see what green looks like must not lose the photograph.
 */

function renderPicker(currentUrl: string | null, onPick = vi.fn()) {
  render(
    <AvatarPresetPicker
      name="Ada Lovelace"
      userId="u-1"
      currentUrl={currentUrl}
      busy={false}
      onPick={onPick}
    />,
  );
  return onPick;
}

describe("AvatarPresetPicker", () => {
  it("recolours the mark you already wear", () => {
    const onPick = renderPicker(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    // The mark is carried over — a colour tap changes one half, not both.
    expect(onPick).toHaveBeenCalledWith("tent", "VIOLET");
  });

  it("puts a new mark on in the colour already showing", () => {
    const onPick = renderPicker(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(screen.getByRole("button", { name: "Compass" }));
    expect(onPick).toHaveBeenCalledWith("compass", "SKY");
  });

  it("stages a colour rather than choosing a mark on the reader's behalf", () => {
    // Someone wearing a photograph. Committing here would mean a swatch tap
    // silently deleted their picture and replaced it with a mark they never
    // chose — so nothing is sent, and the panel says what is missing.
    const onPick = renderPicker("https://trips.example/uploads/ada.webp");
    fireEvent.click(screen.getByRole("button", { name: "Rose" }));
    expect(onPick).not.toHaveBeenCalled();
    expect(
      screen.getByText("Pick a mark to wear it in this colour."),
    ).toBeInTheDocument();

    // And the mark that completes it carries the staged colour with it.
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(onPick).toHaveBeenCalledWith("camera", "ROSE");
  });

  it("keeps a mark worn before colours existed on the colour it is drawn in", () => {
    // `preset:tent` names no colour, so it renders in the hue generated from
    // the id. Picking a mark has to store *some* colour, and storing anything
    // other than the nearest palette would recolour the reader as a side effect
    // of choosing a picture.
    const onPick = renderPicker("preset:tent");
    fireEvent.click(screen.getByRole("button", { name: "Anchor" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    const [preset, colour] = onPick.mock.calls[0]!;
    expect(preset).toBe("anchor");
    expect(colour).toBeTruthy();
  });

  it("says nothing is missing until a colour is actually staged", () => {
    renderPicker("https://trips.example/uploads/ada.webp");
    expect(
      screen.queryByText("Pick a mark to wear it in this colour."),
    ).toBeNull();
  });
});
