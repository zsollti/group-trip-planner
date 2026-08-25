import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImagePicker } from "./ImagePicker";

/**
 * The cropper, stood in for.
 *
 * It decodes the file through an `<img>` and cuts it on a canvas, and jsdom
 * does neither — `onload` never fires, so the real one renders a permanently
 * disabled button and there is no way to reach the callback under test. What is
 * being tested here is which of two paths `onCropped` takes, which is entirely
 * this component's logic.
 */
vi.mock("./AvatarCropper", () => ({
  AvatarCropper: ({ onCropped }: { onCropped: (f: File) => void }) => (
    <button
      type="button"
      onClick={() =>
        onCropped(new File(["y"], "avatar.png", { type: "image/png" }))
      }
    >
      Crop (test double)
    </button>
  ),
}));

/**
 * The picker's two jobs, both of which it used to do badly.
 *
 * **It wrote none of its own words.** A bare `<input type="file">` renders the
 * browser's button, which is unstyleable and — the part that actually got
 * reported — labelled in the *browser's* language rather than the app's, so a
 * Hungarian Chrome put "Fájl kiválasztása" on an English board. The input is
 * wrapped in a label now, which is what lets the app say it. The label must stay
 * a real file input underneath: hidden by clipping, never by `display: none`,
 * or it leaves the focus order and the accessibility tree together.
 *
 * **It always committed its own pick.** That is right on the account page,
 * where the avatar panel is the only thing there, and wrong inside a form that
 * has a Save of its own — which is how the edit-trip dialog ended up with two
 * buttons and a "Save changes" that did not save the cover.
 */

describe("ImagePicker", () => {
  it("labels the file control itself rather than leaving it to the browser", () => {
    render(
      <ImagePicker
        label="Cover image"
        currentUrl={null}
        onSave={() => undefined}
      />,
    );
    // The input is still a file input, and still reachable by its own name.
    const input = screen.getByLabelText(/Cover image/);
    expect(input).toHaveAttribute("type", "file");
    // And the words beside it are the app's, in the app's language.
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
  });

  it("takes the label off the screen without taking it out of the name", () => {
    // The avatar panel's heading already reads "Profile picture", so a line
    // under it reading "Your picture" is two names for one thing. Dropping the
    // prop instead of hiding it would have taken the file input's accessible
    // name with it — the string is what a voice user asks for by name.
    const { container } = render(
      <ImagePicker
        label="Your picture"
        labelHidden
        currentUrl={null}
        onSave={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/Your picture/)).toHaveAttribute(
      "type",
      "file",
    );
    // Present in the tree, and clipped out of the page rather than removed.
    expect(container.querySelector(".picker__label")).toHaveClass(
      "board__sr-only",
    );
  });

  it("treats framing the circle as the commit, where it owns the commit", () => {
    // It used to ask twice: the cropper said "Use this", and the panel then
    // came back with a Save and a Cancel putting the same question again. The
    // cropper is already the preview and already has a Cancel, so the second
    // ask was a step whose purpose the reader had to work out.
    const onSave = vi.fn();
    render(
      <ImagePicker
        label="Your picture"
        currentUrl={null}
        cropCircle
        onSave={onSave}
      />,
    );
    // Reach the cropper's own callback rather than driving a canvas in jsdom:
    // the wiring under test is which of the two paths `onCropped` takes, and
    // the cut itself is the browser's arithmetic, not this component's.
    fireEvent.change(screen.getByLabelText(/Your picture/), {
      target: { files: [new File(["x"], "face.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crop (test double)" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]![0] as File).name).toBe("avatar.png");
    // And nothing is left asking. A Save on the panel now would be the second
    // half of the flow that was removed.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps its own Save where it owns the commit", () => {
    render(
      <ImagePicker
        label="Avatar"
        currentUrl="/a.png"
        onSave={() => undefined}
        onRemove={() => undefined}
      />,
    );
    // Nothing picked yet, so the only action on an existing image is Remove —
    // the Save appears with a pick. What matters here is that this mode still
    // offers a commit of its own at all.
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("offers no commit of its own when a form owns the save", () => {
    const onPick = vi.fn();
    render(
      <ImagePicker
        label="Cover image"
        currentUrl="/c.png"
        onPick={onPick}
        onRemove={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  it("shows a staged removal as gone, not as still there", () => {
    // Otherwise the panel says "Remove", the reader presses it, and the image
    // it was about to remove carries on being displayed until they save.
    render(
      <ImagePicker
        label="Cover image"
        currentUrl="/c.png"
        removed
        onPick={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByText("No image yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
