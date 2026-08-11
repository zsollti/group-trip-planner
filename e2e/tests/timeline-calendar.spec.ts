import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, laneNamed, seedAndSignIn } from "../support/actions";

/**
 * **The week grid puts a decision at its own hour, in its own day.**
 *
 * The grid's whole claim is geometric: a day is a column, an hour is a height,
 * and a block's position and size *mean* when it starts and how long it runs.
 * Nothing cheaper can check that. jsdom does no layout, so the board's DOM
 * suite can only assert the percentage a block asked for — not whether the
 * browser honoured it, whether the block landed under the right weekday, or
 * whether a four-hour trip really is drawn taller than a two-hour one.
 *
 * So this asserts real boxes: a block's horizontal centre inside its own day
 * column, duration as height, and a multi-day bar reaching from the first day
 * it covers to the last. Behavioural and numeric — no screenshots, per the
 * standing project rule.
 *
 * The vertical spine that narrow viewports get has its own spec.
 */

test.describe.configure({ mode: "serial" });

// Comfortably past the 64rem line where the grid takes over.
test.use({ viewport: { width: 1440, height: 1000 } });

/*
 * Accounts here are **seeded, not registered through the form** — the reason
 * `seedAndSignIn` exists. `POST /auth/register` is throttled at five a minute,
 * and the suite runs serially in one window; adding two more front-door
 * registrations tipped the whole file into 429s that surfaced as a missing
 * "Check your inbox" heading. The front door has its own journey; these are
 * about geometry.
 */

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

const pad = (n: number) => String(n).padStart(2, "0");

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function at(offset: number, hour: number, minute = 0): string {
  return `${day(offset)}T${pad(hour)}:${pad(minute)}`;
}

/** Propose an option in a lane and lock it, so it reaches the itinerary. */
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
  // Wait for *either* before branching: deciding on `isVisible()` alone races
  // the lane's own options query.
  await expect(first.or(add)).toBeVisible();
  if (await first.isVisible()) await first.click();
  else await add.click();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Starts (optional)").fill(starts);
  await page.getByLabel("Ends (optional)").fill(ends);
  await page.getByRole("button", { name: "Propose option" }).click();

  await lane
    .getByRole("button", { name: new RegExp(`actions for ${title}`, "i") })
    .click();
  await page
    .getByRole("button", { name: /^(Move to Decided|Lock card)$/ })
    .click();
  await expect(
    lane.locator(".lane__card--settled", { hasText: title }),
  ).toBeVisible();
}

/** Let a lane hold more than one decision at a time. */
async function allowSeveral(page: Page, category: string): Promise<void> {
  await page.getByRole("button", { name: `${category} lane actions` }).click();
  await page.getByRole("button", { name: "Allow several winners" }).click();
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element is not laid out");
  return b;
}

test("the grid places a decision at its hour, in its day, at its length", async ({
  page,
}) => {
  const start = day(30);
  const end = day(36);

  await seedAndSignIn(page, "Wren");
  const tripId = await createBoard(page, `Grid ${Date.now().toString(36)}`, {
    start,
    end,
  });

  await allowSeveral(page, "Activities");
  // Same day: two hours in the morning, four in the afternoon.
  await decide(
    page,
    laneNamed(page, "Activities"),
    "Tram",
    at(31, 10),
    at(31, 12),
  );
  await decide(
    page,
    laneNamed(page, "Activities"),
    "Belem",
    at(31, 14),
    at(31, 18),
  );
  // A different day, so the column test has something to be wrong about.
  await decide(
    page,
    laneNamed(page, "Activities"),
    "Museum",
    at(33, 11),
    at(33, 13),
  );
  // Three nights in one bar.
  await decide(
    page,
    laneNamed(page, "Accommodation"),
    "Hotel Luna",
    at(30, 15),
    at(33, 10),
  );

  await page.goto(`/trips/${tripId}/timeline`);
  await expect(page.locator(".cal")).toBeVisible();

  const columnFor = (offset: number) =>
    page.locator(`.cal__head[data-day="${day(offset)}"]`);
  const eventNamed = (title: string) =>
    page.locator(".cal__event", { hasText: title });

  // --- each block sits under its own weekday ------------------------------
  for (const [title, offset] of [
    ["Tram", 31],
    ["Belem", 31],
    ["Museum", 33],
  ] as const) {
    const event = await box(eventNamed(title));
    const column = await box(columnFor(offset));
    const centre = event.x + event.width / 2;
    expect(
      centre,
      `${title} should sit under ${day(offset)}`,
    ).toBeGreaterThanOrEqual(column.x);
    expect(centre).toBeLessThanOrEqual(column.x + column.width);
  }

  // --- height means duration ----------------------------------------------
  const tram = await box(eventNamed("Tram"));
  const belem = await box(eventNamed("Belem"));
  // Four hours against two: the ratio is the assertion, since the hour height
  // is a token and may be tuned.
  expect(belem.height / tram.height).toBeGreaterThan(1.8);
  expect(belem.height / tram.height).toBeLessThan(2.2);

  // --- and the later thing is lower ---------------------------------------
  expect(belem.y).toBeGreaterThan(tram.y + tram.height);

  // --- a multi-day stay is one bar across the days it covers --------------
  const bar = await box(page.locator(".cal__bar", { hasText: "Hotel Luna" }));
  const firstDay = await box(columnFor(30));
  const lastDay = await box(columnFor(33));
  // Starts within the first day's column and reaches into the last one. Both
  // edges matter: a bar collapsed to one column passes a start-only check.
  expect(bar.x).toBeGreaterThanOrEqual(firstDay.x - 4);
  expect(bar.x).toBeLessThan(firstDay.x + firstDay.width);
  expect(bar.x + bar.width).toBeGreaterThan(lastDay.x);

  // …and it is above the hours rather than among them, which is the whole
  // reason a stay is not drawn on every day at every hour.
  expect(bar.y + bar.height).toBeLessThanOrEqual(tram.y);
  // --- and the same trip, narrow, keeps the vertical spine ----------------
  // The grid is the wide-screen layout, not a replacement: a week across a
  // phone gives each day about fifty pixels, which is not a calendar. Checked
  // on the trip we already have rather than in a test of its own — every extra
  // sign-in is spent against a login limit this serial suite shares.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".tl__grid")).toBeVisible();
  await expect(page.locator(".cal")).toHaveCount(0);
});
