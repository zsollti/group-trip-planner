import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import type { PlaceView } from "@gtp/types";
import { DestinationField } from "./DestinationField";

/**
 * The destination field, whose whole job is a distinction: *chosen* against
 * *typed*.
 *
 * A trip that resolved to a place gets its clock, its coordinates and its
 * country's currency; a trip whose destination was typed gets none of those and
 * is still a perfectly good trip. Everything below is one side of that line, plus
 * the two mechanics that make the line reachable — a debounce, so a query is not
 * a keystroke, and a keyboard, so the list is not mouse-only.
 *
 * The fetch is stubbed rather than the hook: what is being tested includes *when*
 * a request goes out, and mocking the hook would answer that question by
 * assumption.
 */

const LISBON: PlaceView = {
  id: 2267057,
  kind: "CITY",
  name: "Lisbon",
  region: "Lisboa",
  countryCode: "PT",
  countryName: "Portugal",
  currencyCode: "EUR",
  timezone: "Europe/Lisbon",
  latitude: 38.7,
  longitude: -9.1,
};

function stubFetch(places: PlaceView[] = [LISBON]) {
  // The signature is given rather than inferred. From a bare `vi.fn(() => …)`
  // TypeScript infers a zero-length tuple for `mock.calls`, and reading
  // `calls[0][0]` is then an error on an array the test has just proved is not
  // empty — while adding an unused parameter to fix that trades the type error
  // for a lint one.
  const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ places }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({
  onChange,
  initial = "",
}: {
  onChange: (next: { destination: string; place: PlaceView | null }) => void;
  initial?: string;
}) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <DestinationField id="dest" value={initial} onChange={onChange} />
    </QueryClientProvider>
  );
}

/**
 * Fake timers, for the two tests about **when** a request goes out.
 *
 * Only those two. The tests about the list wait for it with `findBy*` on real
 * timers instead, and the split is deliberate rather than lazy: react-query
 * notifies its subscribers through its own scheduler, so a fake clock has to be
 * advanced in step with a promise chain nobody here owns. Doing that got the
 * fetch to fire and the list to never render — a passing assertion and a missing
 * element, which is the most misleading shape a test failure has. Waiting out a
 * real 250ms costs a quarter-second and describes the component instead of the
 * scheduler.
 */
async function pastTheDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

describe("DestinationField", () => {
  it("waits for a pause before asking the server", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch();
    render(<Harness onChange={() => undefined} />);
    const input = screen.getByRole("combobox");

    for (const text of ["l", "li", "lis", "lisb"]) {
      fireEvent.change(input, { target: { value: text } });
    }
    // Four letters, no request yet: a query per keystroke is four times the load
    // for one answer, and the first three answers are already stale.
    expect(fetchMock).not.toHaveBeenCalled();

    await pastTheDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("q=lisb");
    vi.useRealTimers();
  });

  it("asks nothing at all for one letter", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch();
    render(<Harness onChange={() => undefined} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "l" } });
    await pastTheDebounce();
    // One letter matches thousands of places and ranks them by population, which
    // is a list of capital cities rather than an answer.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports typed text with no place behind it", () => {
    stubFetch();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Dad's cabin" },
    });
    // The whole reason this is an input and not a select. A string that happens
    // to match somewhere real is still not a choice — including then.
    expect(onChange).toHaveBeenLastCalledWith({
      destination: "Dad's cabin",
      place: null,
    });
  });

  it("reports the place when one is chosen from the list", async () => {
    stubFetch();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "lisb" },
    });

    const option = await screen.findByRole("option", { name: /Lisbon/ });
    // `mouseDown`, not `click`: the field commits on it, because the input's
    // blur fires first on a real click and would take the button away.
    fireEvent.mouseDown(option);

    // The label the list showed is the string the trip stores, so choosing a
    // suggestion cannot silently change what the reader picked.
    expect(onChange).toHaveBeenLastCalledWith({
      destination: "Lisbon, Lisboa, Portugal",
      place: LISBON,
    });
  });

  it("is driveable from the keyboard, with focus never leaving the field", async () => {
    stubFetch();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "lisb" } });
    await screen.findByRole("option", { name: /Lisbon/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    // The highlight is `aria-activedescendant`, not focus: the reader has to be
    // able to keep typing while a suggestion is highlighted, so nothing in the
    // list may take the cursor.
    expect(input).toHaveAttribute("aria-activedescendant");
    expect(screen.getByRole("option", { name: /Lisbon/ })).not.toBe(
      document.activeElement,
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      destination: "Lisbon, Lisboa, Portugal",
      place: LISBON,
    });
  });

  it("closes on Escape without touching what was typed", async () => {
    stubFetch();
    render(<Harness onChange={() => undefined} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "lisb" } });
    await screen.findByRole("option", { name: /Lisbon/ });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("option")).toBeNull();
    // Dismissing a suggestion is not undoing your typing.
    expect(input).toHaveValue("lisb");
  });

  it("draws the list outside the box that would clip it", async () => {
    stubFetch();
    // The field's own surroundings, standing in for a dialog body: every screen
    // this field appears on scrolls one, and a scrolling box clips whatever
    // sticks out of it — which is what cut the suggestions off two rows down on
    // the create-trip stepper, where the panel is one question tall.
    //
    // jsdom does no layout, so the clipping itself is invisible here. What is
    // assertable is the structure that prevents it, which is the same call the
    // chat panel's overflow menu made: the list must not be a descendant of the
    // element that scrolls.
    const { container } = render(
      <div className="scrolls" style={{ overflowY: "auto", height: 40 }}>
        <Harness onChange={() => undefined} />
      </div>,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "lisb" },
    });

    const option = await screen.findByRole("option", { name: /Lisbon/ });
    expect(container.querySelector(".scrolls")?.contains(option)).toBe(false);
    // …and it is still the input's listbox, wherever it is drawn: the pairing is
    // `aria-controls`, which does not care about the tree.
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
  });
  it("does not open a list over a destination the trip already has", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch();
    render(<Harness onChange={() => undefined} initial="Lisbon, Portugal" />);
    await pastTheDebounce();
    // Opening the edit dialog should not greet the reader with eight suggestions
    // for the place they chose months ago — nothing has been typed.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("option")).toBeNull();
    vi.useRealTimers();
  });
});
