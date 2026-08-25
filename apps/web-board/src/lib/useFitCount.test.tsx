import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useFitCount } from "./fitTabs";

/**
 * The measuring half of the switcher, which the arithmetic tests cannot reach.
 *
 * `fitCount` is pure and covered on its own numbers; what broke in use was the
 * *plumbing* — when the hook looks. The row it measures lives inside the chat
 * panel, which is closed on first render, so both refs were null the only time
 * the effect ran. The count then kept its initial value — the item count at
 * mount, which is **zero**, because the channels arrive later over the socket —
 * and opening the chat showed a switcher with no chips at all and a "＋4".
 *
 * jsdom does no layout, so the widths are stubbed. That is enough: what is under
 * test is whether a measurement happens at all and against which nodes, not
 * whether the browser can add up.
 */

/** Every element reports the same width, which is all the arithmetic needs —
 *  except where a test wants one node to differ, which it says with `data-w`. */
const CHIP_WIDTH = 60;
const ROW_WIDTH = 200;

function Row({
  open,
  items,
  reserveWidth,
}: {
  open: boolean;
  items: readonly string[];
  /** Render a measured overflow trigger of this width; omit for none. */
  reserveWidth?: number;
}) {
  const fit = useFitCount(items.length, 40, 5);
  return (
    <div>
      <span data-testid="count">{fit.visibleCount}</span>
      {open ? (
        <div>
          {/* The off-flow copy of the full list — the thing actually measured. */}
          <div ref={fit.measureRef}>
            {items.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          {reserveWidth !== undefined ? (
            <span ref={fit.reserveRef} data-w={reserveWidth} />
          ) : null}
          <div ref={fit.containerRef} />
        </div>
      ) : null}
    </div>
  );
}

const CHANNELS = ["trip", "transport", "stay", "food"];

describe("useFitCount", () => {
  let offset: PropertyDescriptor | undefined;
  let client: PropertyDescriptor | undefined;

  beforeEach(() => {
    offset = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        const stated = this.dataset?.w;
        return stated === undefined ? CHIP_WIDTH : Number(stated);
      },
    });
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get: () => ROW_WIDTH,
    });
  });

  afterEach(() => {
    if (offset)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", offset);
    if (client) Object.defineProperty(Element.prototype, "clientWidth", client);
  });

  it("measures when the row mounts, not only when the list changes", () => {
    // The sequence the chat panel actually goes through: mounted empty and
    // closed, channels arrive over the socket, and only then does the reader
    // open the panel. The item count does not change on that last step, so a
    // hook that only re-measures when it does never measures at all.
    const { rerender } = render(<Row open={false} items={[]} />);
    rerender(<Row open={false} items={CHANNELS} />);
    rerender(<Row open items={CHANNELS} />);

    // 4 × 60 + 3 gaps = 255 > 200, so the trigger (40) and its gap come off,
    // leaving 155: two chips (125) fit and a third (190) does not.
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("holds back the trigger's measured width, not the fallback", () => {
    // The bug this guards: the reserve was a constant sized for the widest the
    // trigger ever gets, so a row whose trigger is actually narrow gave away a
    // chip and left the space it would have used sitting empty beside it.
    // Same row, same chips — only the trigger's real width differs.
    const { rerender } = render(<Row open items={CHANNELS} />);
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    // 200 − 5 (trigger) − 5 (its gap) = 190, which is exactly three chips.
    rerender(<Row open items={CHANNELS} reserveWidth={5} />);
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("says everything fits until it has looked", () => {
    // Nothing is mounted to measure, so the honest answer is the plain row —
    // never "nothing fits", which is what a count of 0 would mean downstream.
    render(<Row open={false} items={CHANNELS} />);
    expect(screen.getByTestId("count")).toHaveTextContent("4");
  });
});
