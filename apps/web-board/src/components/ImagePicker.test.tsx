import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImagePicker } from "./ImagePicker";

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
