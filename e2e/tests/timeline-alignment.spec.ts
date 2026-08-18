import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, laneNamed, signUpAndIn } from "../support/actions";

/**
 * **The timeline's spans line up with the nights they cover.**
 *
 * The itinerary's whole mechanic is geometric: days run down the page and a
 * stay is drawn *once* in a left gutter, stretched across exactly the day rows
 * it covers, rather than repeated into each of them. Both columns are placed in
 * one CSS grid and the span claims `grid-row: <first> / <last + 1>`.
 *
 * Nothing cheaper can check that. jsdom does no layout, so the board's DOM
 * suite can only assert the `grid-row` string the component *asked* for — it
 * cannot tell you whether the browser honoured it, whether the gutter and the
 * day column ended up in the same grid at all, or whether a stay silently
 * collapsed to one row. That is the same blind spot that let the Decided rail
 * ship with drag-to-decide broken and every test green.
 *
 * So this asserts real boxes: the span's top edge against the first night's day
 * row, its bottom edge against the last, and that it sits beside the days
 * rather than among them. Behavioural and numeric — no screenshots, per the
 * standing project rule.
 */

test.describe.configure({ mode: "serial" });

/**
 * **Narrow on purpose.** The itinerary has two layouts sharing one core: a week
 * grid on wide viewports and this vertical spine below 64rem. The default
 * Desktop Chrome viewport is 1280px, which is the grid — so without this these
 * journeys would silently start asserting about a layout that is not on screen,
 * and the spine's own mechanic would go untested. The grid has its own spec.
 */
test.use({ viewport: { width: 900, height: 900 } });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day `offset` days from today, as `YYYY-MM-DD`. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local wall-clock value; `decide` splits it into the day and time fields. */
function at(offset: number, hour: number, minute = 0): string {
  return `${day(offset)}T${pad(hour)}:${pad(minute)}`;
}

/**
 * Choose a start and an end on the option form's calendar.
 *
 * The two `<input type="date">`s are gone — the grid is the control now, so a
 * day is clicked rather than typed. The grid opens on the trip's own month and
 * draws two months plus the neighbouring days, so a target a few days out is
 * normally on screen; it pages forward when it is not, which keeps this true
 * whatever day the suite runs on.
 */
async function pickDays(page: Page, startDay: string, endDay: string) {
  for (const iso of [startDay, endDay]) {
    const cell = page.locator(`.drange__day[data-day="${iso}"]`);
    for (let i = 0; i < 6 && (await cell.count()) === 0; i += 1) {
      await page.getByRole("button", { name: "Next month" }).click();
    }
    await cell.first().click();
  }
}

/**
 * Propose an option in a lane and lock it.
 *
 * Locking goes through the card's "⋯" menu rather than the drag, deliberately:
 * the drag has its own spec, and this journey is about what the timeline does
 * with a decision, not about how the decision was made.
 */
async function decide(
  page: Page,
  lane: Locator,
  title: string,
  starts: string,
  ends: string,
): Promise<void> {
  const first = lane.getByRole("button", {
    name: "＋ Propose the first option",
  });
  const add = lane.getByRole("button", { name: "+ Add card" });
  // Wait for *either* before branching. Deciding on `isVisible()` alone races
  // the lane's own options query: while it is still loading neither button is
  // in the DOM, so the check falls through to the wrong one and hangs.
  await expect(first.or(add)).toBeVisible();
  if (await first.isVisible()) await first.click();
  else await add.click();

  await page.getByLabel("Title").fill(title);
  // The form asks for the two days on one calendar and the times beside it, so
  // a wall-clock value is filled in two halves. The `at()` helper still writes
  // one string, because that is what the assertions are about.
  await pickDays(page, starts.slice(0, 10), ends.slice(0, 10));
  // `selectOption`, not `fill`: the times are a quarter-hour list now rather
  // than a free-text clock. `at()` only ever builds whole hours, so every value
  // these journeys ask for is on that grid.
  await page
    .getByLabel("Start time")
    .selectOption(starts.slice(11, 16));
  await page.getByLabel("End time").selectOption(ends.slice(11, 16));
  await page.getByRole("button", { name: "Propose option" }).click();

  await lane
    .getByRole("button", { name: new RegExp(`actions for ${title}`, "i") })
    .click();
  // Single-choice lanes say "Move to Decided", multi-select ones "Lock card".
  await page
    .getByRole("button", { name: /^(Move to Decided|Lock card)$/ })
    .click();
  await expect(
    lane.locator(".lane__card--settled", { hasText: title }),
  ).toBeVisible();
}

/** Top and bottom edges of a laid-out element. */
async function edges(locator: Locator): Promise<{
  top: number;
  bottom: number;
  left: number;
  right: number;
}> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element is not laid out");
  return {
    top: box.y,
    bottom: box.y + box.height,
    left: box.x,
    right: box.x + box.width,
  };
}

test("a stay is drawn once, spanning exactly the nights it covers", async ({
  page,
}) => {
  // An eight-day trip starting a month out, so the write-back rule that
  // refuses a past start is satisfied whenever this runs.
  const start = day(30);
  const end = day(37);

  await signUpAndIn(page, "Cato");
  const tripId = await createBoard(
    page,
    `Timeline ${Date.now().toString(36)}`,
    {
      start,
      end,
    },
  );

  // Three nights: checks in on the first afternoon, out on the fourth morning.
  await decide(
    page,
    laneNamed(page, "Accommodation"),
    "Hotel Luna",
    at(30, 15),
    at(33, 10),
  );
  // A same-day thing, which must land *in* a day rather than in the gutter.
  await decide(
    page,
    laneNamed(page, "Activities"),
    "Museum",
    at(31, 10),
    at(31, 12),
  );

  await page.getByRole("link", { name: "Timeline" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/timeline$`));

  // Eight day rows, one per day of the trip.
  const days = page.locator("[data-day]");
  await expect(days).toHaveCount(8);

  // Drawn once — the failure a day-by-day agenda makes is repeating a stay
  // into every day section it touches.
  await expect(page.getByText("Hotel Luna")).toHaveCount(1);
  await expect(page.getByText("3 nights")).toBeVisible();

  const span = page.locator(".tl__span");
  await expect(span).toHaveCount(1);

  const spanBox = await edges(span);
  const arrival = await edges(page.locator(`[data-day="${day(30)}"]`));
  const checkout = await edges(page.locator(`[data-day="${day(33)}"]`));
  const dayAfter = await edges(page.locator(`[data-day="${day(34)}"]`));

  // The real assertion: the span's own box covers the arrival day through the
  // checkout day and stops there. A collapsed span would fail the bottom edge;
  // a span that fell out of the shared grid would fail both.
  expect(Math.abs(spanBox.top - arrival.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(spanBox.bottom - checkout.bottom)).toBeLessThanOrEqual(2);
  // Ends *at* the next day, never inside it. Equality is the correct result:
  // the rows are adjacent, since the day rules do the separating and a row gap
  // would put a dead band inside every span that crossed one.
  expect(spanBox.bottom).toBeLessThanOrEqual(dayAfter.top);

  // …and it sits beside the days, not among them.
  expect(spanBox.right).toBeLessThanOrEqual(arrival.left + 1);

  // The same-day option is inside its day, where the time of day is the point.
  const museumDay = page.locator(`[data-day="${day(31)}"]`);
  await expect(museumDay.getByText("Museum")).toBeVisible();
  await expect(page.locator(".tl__span").getByText("Museum")).toHaveCount(0);
});

test("the timeline confesses a decision it cannot place", async ({ page }) => {
  // The other promise the page makes: a locked option with no dates is still
  // on the screen, because a view that quietly drew some of the decisions would
  // be read as the whole trip.
  await signUpAndIn(page, "Dita");
  await createBoard(page, `Untimed ${Date.now().toString(36)}`, {
    start: day(30),
    end: day(37),
  });

  const stay = laneNamed(page, "Accommodation");
  await stay
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await page.getByLabel("Title").fill("Somewhere, eventually");
  await page.getByRole("button", { name: "Propose option" }).click();
  await stay
    .getByRole("button", { name: /actions for Somewhere, eventually/i })
    .click();
  // Either mode's label — see the note on the helper above.
  await page
    .getByRole("button", { name: /^(Move to Decided|Lock card)$/ })
    .click();

  await page.getByRole("link", { name: "Timeline" }).click();

  const tray = page.getByRole("region", { name: "Not on the timeline" });
  await expect(tray.getByText("Somewhere, eventually")).toBeVisible();
  await expect(tray.getByText("No dates yet")).toBeVisible();
});
