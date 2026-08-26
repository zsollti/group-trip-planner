import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { avatarPresetUrl } from "@gtp/types";
import { AvatarField } from "./AvatarField";

/**
 * One picture, two strips, and the thing that must not happen between them.
 *
 * A drawn avatar is a mark *and* a colour, but only the mark can be stored — so
 * the interesting cases are all about what a colour tap does depending on what
 * is already on. The expensive way to get it wrong is the generous one: a
 * reader wearing a photograph who taps a swatch to see what green looks like
 * must not lose the photograph without having been asked.
 */

const PHOTO = "https://trips.example/uploads/ada.webp";

function renderField(currentUrl: string | null, onWear = vi.fn()) {
  render(
    <AvatarField
      name="Ada Lovelace"
      userId="u-1"
      currentUrl={currentUrl}
      busy={false}
      error={null}
      onWear={onWear}
      onUpload={vi.fn()}
    />,
  );
  return onWear;
}

/**
 * Spin a strip until the wanted swatch is on screen.
 *
 * Only three of each list are rendered at a time, so a test cannot simply reach
 * for the eleventh mark — it has to walk there, which is also the thing being
 * asserted: that walking works and that it comes back round.
 */
function reach(name: string, arrow: string, limit = 20): HTMLElement {
  for (let i = 0; i < limit; i += 1) {
    const found = screen.queryByRole("button", { name });
    if (found) return found;
    fireEvent.click(screen.getByRole("button", { name: arrow }));
  }
  throw new Error(`never found ${name} after ${limit} steps`);
}

describe("the avatar field", () => {
  it("shows three of each list at a time", () => {
    renderField(null);
    // Twelve marks and eight colours: six buttons of swatch, not twenty.
    const swatches = document.querySelectorAll(".presets__swatch");
    expect(swatches).toHaveLength(6);
  });

  it("comes back round rather than stopping at either end", () => {
    renderField(null);
    // Eight colours, so nine steps forward lands one past a full lap — if the
    // list stopped at the end there would be nothing left to show.
    const first = document.querySelector(".presets__swatch--colour");
    const label = first?.getAttribute("aria-label");
    expect(label).toBeTruthy();
    for (let i = 0; i < 8; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next colour" }));
    }
    const back = document.querySelector(".presets__swatch--colour");
    expect(back?.getAttribute("aria-label")).toBe(label);
  });

  it("opens on the mark you are already wearing", () => {
    renderField(avatarPresetUrl("campfire", "SKY"));
    // Eleventh of twelve. Without the window opening on it, a reader would have
    // to go looking for their own avatar to see it was theirs.
    expect(
      screen.getByRole("button", { name: "Campfire" }),
    ).toBeInTheDocument();
  });

  it("recolours the mark you already wear", () => {
    const onWear = renderField(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(reach("Violet", "Next colour"));
    // The mark is carried over — a colour tap changes one half, not both.
    expect(onWear).toHaveBeenCalledWith("tent", "VIOLET");
  });

  it("puts a new mark on in the colour already showing", () => {
    const onWear = renderField(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(reach("Compass", "Next mark"));
    expect(onWear).toHaveBeenCalledWith("compass", "SKY");
  });

  it("asks before a photograph is replaced, and does nothing if refused", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Camera", "Next mark"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep my photo" }));
    expect(onWear).not.toHaveBeenCalled();
    // And the picture is still what the field shows.
    expect(document.querySelector("img.avatar--image")).not.toBeNull();
  });

  it("wears the mark that was asked about once the answer is yes", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Camera", "Next mark"));
    fireEvent.click(screen.getByRole("button", { name: "Use a drawn avatar" }));

    // The tap that raised the question is the tap that is carried out — being
    // asked "are you sure" and then having to do it again is a step with no
    // purpose.
    expect(onWear).toHaveBeenCalledTimes(1);
    expect(onWear.mock.calls[0]?.[0]).toBe("camera");
  });

  it("asks once, not on every swatch after that", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Rose", "Next colour"));
    fireEvent.click(screen.getByRole("button", { name: "Use a drawn avatar" }));

    // A staged colour is not a commit: a colour alone is not something the
    // account can store, so nothing is sent and the panel says what is missing.
    expect(onWear).not.toHaveBeenCalled();
    expect(
      screen.getByText("Pick a mark to wear it in this colour."),
    ).toBeInTheDocument();

    // The question has been answered, so the next tap goes straight through and
    // carries the staged colour with it.
    fireEvent.click(reach("Camera", "Next mark"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onWear).toHaveBeenCalledWith("camera", "ROSE");
  });

  it("keeps a mark worn before colours existed on the colour it is drawn in", () => {
    // `preset:tent` names no colour, so it renders in the hue generated from
    // the id. Picking a mark has to store *some* colour, and storing anything
    // other than the nearest palette would recolour the reader as a side effect
    // of choosing a picture.
    const onWear = renderField("preset:tent");
    fireEvent.click(reach("Anchor", "Next mark"));
    expect(onWear).toHaveBeenCalledTimes(1);
    const [preset, colour] = onWear.mock.calls[0]!;
    expect(preset).toBe("anchor");
    expect(colour).toBeTruthy();
  });

  it("says nothing is missing until a colour is actually staged", () => {
    renderField(PHOTO);
    expect(
      screen.queryByText("Pick a mark to wear it in this colour."),
    ).toBeNull();
  });

  it("offers no Remove to somebody wearing a drawn mark", () => {
    // There is no uploaded file to remove, and a button that removes nothing is
    // a button that will be pressed to find out what it does.
    renderField(avatarPresetUrl("tent", "SKY"));
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
