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
 * Reach a swatch by name.
 *
 * Every item is in its strip the whole time now — the strip scrolls rather than
 * re-dealing a window of three — so this is a plain lookup. It stays a helper
 * because the tests below read better naming the swatch than the query, and
 * because it is where the old "walk there with the arrow" step used to live.
 */
function reach(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Give the strip and its swatches a size, since jsdom lays nothing out — this
 *  is what `itemPitch` measures, and with no layout the arrows are no-ops. */
function sizeSwatches(width: number) {
  return vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockReturnValue(width);
}

/**
 * Dispatch one pointer event with a real x coordinate.
 *
 * jsdom implements no `PointerEvent` at all, so `fireEvent.pointerDown` falls
 * back to a bare `Event` and quietly drops `clientX` — which is the only thing
 * a pan reads, so the strip would move by NaN and the test would pass or fail
 * for the wrong reason. A `MouseEvent` typed `pointerdown` carries the
 * coordinate and still reaches React's `onPointerDown`, which dispatches on the
 * event's name.
 */
function pointer(el: HTMLElement, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(el, event);
}

describe("the avatar field", () => {
  it("holds every colour and every mark at once", () => {
    renderField(null);
    // Eight colours and twelve marks, all of them in their strip: the reader
    // scrolls to one rather than being dealt three at a time.
    expect(document.querySelectorAll(".presets__swatch--colour")).toHaveLength(
      8,
    );
    expect(document.querySelectorAll(".presets__swatch")).toHaveLength(20);
  });

  it("slides along by one swatch when an arrow is pressed", () => {
    const size = sizeSwatches(40);
    try {
      renderField(null);
      const strip = document.querySelector<HTMLElement>(".presets__window")!;
      expect(strip.scrollLeft).toBe(0);
      fireEvent.click(screen.getByRole("button", { name: "Next colour" }));
      // One swatch along, not a whole new set of them.
      expect(strip.scrollLeft).toBe(40);
      fireEvent.click(screen.getByRole("button", { name: "Previous colour" }));
      expect(strip.scrollLeft).toBe(0);
    } finally {
      size.mockRestore();
    }
  });

  it("pans with a drag, and the drag does not count as a tap", () => {
    const onWear = renderField(avatarPresetUrl("tent", "SKY"));
    const strip = document.querySelector<HTMLElement>(".presets__window")!;
    const swatch = reach("Violet");

    pointer(strip, "pointerdown", 100);
    pointer(strip, "pointermove", 40);
    // Dragged left by 60, so the strip is 60 further along.
    expect(strip.scrollLeft).toBe(60);
    pointer(strip, "pointerup", 40);

    // The pointer came to rest over a swatch, and letting go of a drag must not
    // recolour the reader's avatar.
    fireEvent.click(swatch);
    expect(onWear).not.toHaveBeenCalled();

    // The next real tap goes through.
    fireEvent.click(swatch);
    expect(onWear).toHaveBeenCalledWith("tent", "VIOLET");
  });

  it("opens scrolled to the mark you are already wearing", () => {
    // jsdom lays nothing out, so the geometry the strip reads is mocked: every
    // swatch 40 wide, sitting 40 apart, in a 120-wide box.
    const width = sizeSwatches(40);
    const left = vi
      .spyOn(HTMLElement.prototype, "offsetLeft", "get")
      .mockImplementation(function (this: HTMLElement) {
        const parent = this.parentElement;
        if (!parent) return 0;
        return Array.prototype.indexOf.call(parent.children, this) * 40;
      });
    const box = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(120);
    try {
      renderField(avatarPresetUrl("campfire", "SKY"));
      const strips = document.querySelectorAll<HTMLElement>(".presets__window");
      // Eleventh of twelve marks: 10 × 40, less the margin that centres it in
      // the box. Without this the strip opens at zero and a reader has to go
      // looking for their own avatar to see it is theirs.
      expect(strips[1]!.scrollLeft).toBe(360);
    } finally {
      width.mockRestore();
      left.mockRestore();
      box.mockRestore();
    }
  });

  it("recolours the mark you already wear", () => {
    const onWear = renderField(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(reach("Violet"));
    // The mark is carried over — a colour tap changes one half, not both.
    expect(onWear).toHaveBeenCalledWith("tent", "VIOLET");
  });

  it("puts a new mark on in the colour already showing", () => {
    const onWear = renderField(avatarPresetUrl("tent", "SKY"));
    fireEvent.click(reach("Compass"));
    expect(onWear).toHaveBeenCalledWith("compass", "SKY");
  });

  it("asks before a photograph is replaced, and does nothing if refused", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Camera"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep my photo" }));
    expect(onWear).not.toHaveBeenCalled();
    // And the picture is still what the field shows.
    expect(document.querySelector("img.avatar--image")).not.toBeNull();
  });

  it("wears the mark that was asked about once the answer is yes", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Camera"));
    fireEvent.click(screen.getByRole("button", { name: "Use a drawn avatar" }));

    // The tap that raised the question is the tap that is carried out — being
    // asked "are you sure" and then having to do it again is a step with no
    // purpose.
    expect(onWear).toHaveBeenCalledTimes(1);
    expect(onWear.mock.calls[0]?.[0]).toBe("camera");
  });

  it("asks once, not on every swatch after that", () => {
    const onWear = renderField(PHOTO);
    fireEvent.click(reach("Rose"));
    fireEvent.click(screen.getByRole("button", { name: "Use a drawn avatar" }));

    // A staged colour is not a commit: a colour alone is not something the
    // account can store, so nothing is sent and the panel says what is missing.
    expect(onWear).not.toHaveBeenCalled();
    expect(
      screen.getByText("Pick a mark to wear it in this colour."),
    ).toBeInTheDocument();

    // The question has been answered, so the next tap goes straight through and
    // carries the staged colour with it.
    fireEvent.click(reach("Camera"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onWear).toHaveBeenCalledWith("camera", "ROSE");
  });

  it("keeps a mark worn before colours existed on the colour it is drawn in", () => {
    // `preset:tent` names no colour, so it renders in the hue generated from
    // the id. Picking a mark has to store *some* colour, and storing anything
    // other than the nearest palette would recolour the reader as a side effect
    // of choosing a picture.
    const onWear = renderField("preset:tent");
    fireEvent.click(reach("Anchor"));
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
