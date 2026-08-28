import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, laneNamed, seedAndSignIn } from "../support/actions";

/**
 * **The reader's own column, end to end.**
 *
 * Two real browser contexts, because privacy is the entire claim and it cannot
 * be checked from one screen. Everything else about this feature is asserted in
 * unit tests already; what only a real pair of sessions can prove is the
 * negative — that a member of the same trip, on the same board, looking at the
 * same URL, sees no trace of somebody else's list. That is the assertion this
 * journey exists for.
 *
 * The rest of it walks the loop a person actually takes: add an item, see it in
 * the column, switch the cost panel to their own reading, and set a budget of
 * their own — the one target their private money is counted against, and the
 * second per-member figure this journey can prove is private, since a budget
 * one member sets must be invisible to the other.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

/** A second signed-in browser, isolated from the first (own storage + socket). */
async function secondBrowser(
  context: BrowserContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** The reader's own column — a landmark, like every lane beside it. */
function myColumn(page: Page) {
  return page.getByRole("region", { name: "Personal" });
}

test("a member keeps a private list that nobody else on the board can see", async ({
  page: ownerPage,
  context: ownerContext,
  browser,
}) => {
  const tripName = `Porto ${Date.now().toString(36)}`;
  const mine = "Flight home";

  await seedAndSignIn(ownerPage, "Ada");
  const tripId = await createBoard(ownerPage, tripName);

  // --- the column is there before anything is in it ------------------------
  // It is the only place the feature announces itself, so an empty board has
  // to offer it. A column that appeared once you already had an item would be
  // findable only by people who already knew about it.
  const column = myColumn(ownerPage);
  await expect(column).toBeVisible();
  await expect(column.getByText("Only you can see these")).toBeVisible();

  // --- Ada adds something only she pays for --------------------------------
  await column
    .getByRole("button", { name: /Add something only you pay for/ })
    .click();
  await ownerPage.getByLabel("Title").fill(mine);
  await ownerPage.getByLabel("Amount").fill("210");
  await ownerPage.getByRole("button", { name: "Add item" }).click();

  await expect(column.getByText(mine)).toBeVisible();

  // --- the cost panel's second reading -------------------------------------
  // Always offered, on every board: the trip's reading is group money and its
  // target line speaks for the group, so this switch is the only way to a
  // figure about the reader themselves.
  const whose = ownerPage.getByRole("group", { name: "Whose money" });
  await expect(whose).toBeVisible();
  await expect(whose.getByRole("button", { name: "The trip" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The trip's reading says nothing about her flight...
  await expect(
    ownerPage.getByText(/Not counted against the target/),
  ).toBeHidden();
  // ...and hers names it, and says what it is not part of.
  await whose.getByRole("button", { name: "Mine" }).click();
  await expect(
    ownerPage.getByText(/Not counted against the target/),
  ).toBeVisible();

  // --- a budget of her own, which is what does count it --------------------
  // The trip's target refuses this money by design. Hers is the number it is
  // for, so setting one has to flip both halves: a verdict appears, and the
  // sentence disclaiming her flight goes, because it would now be false.
  await ownerPage.getByRole("button", { name: "Set your own budget" }).click();
  await ownerPage.getByLabel(/What you can spend/).fill("400");
  await ownerPage.getByRole("button", { name: "Save" }).click();

  // 210 of her own against 400, and nothing else decided on this board yet.
  // The shortfall is the chart's own row: the line under it states the target
  // and no longer repeats the row's figure two lines below it.
  await expect(ownerPage.getByText("Still to spend")).toBeVisible();
  await expect(ownerPage.getByText("Target")).toBeVisible();
  await expect(
    ownerPage.getByText(/Not counted against the target/),
  ).toBeHidden();
  // The way in now offers to change it rather than to set one.
  await expect(
    ownerPage.getByRole("button", { name: "Change your budget" }),
  ).toBeVisible();

  // --- and it is on her itinerary, on the trip's own axis ------------------
  await ownerPage.getByRole("link", { name: "Timeline" }).click();
  await ownerPage.waitForURL(`**/trips/${tripId}/timeline`);
  // Undated, so it is confessed in the tray rather than dropped — the same
  // treatment a decision with no dates gets, and for the same reason.
  await expect(ownerPage.getByText(mine)).toBeVisible();
  await ownerPage.getByRole("link", { name: "Plan" }).click();

  // --- a second member joins the same board --------------------------------
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  await ownerPage.getByRole("button", { name: "Create link" }).click();
  await ownerPage.getByRole("button", { name: "Copy link" }).click();
  const joinUrl = await ownerPage.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await ownerPage.getByRole("button", { name: "Close" }).click();

  const guestContext = await browser.newContext();
  const { page: memberPage, close: closeGuest } =
    await secondBrowser(guestContext);
  try {
    await seedAndSignIn(memberPage, "Grace");
    await memberPage.goto(joinUrl);
    await memberPage.waitForURL(`**/trips/${tripId}`);

    // Grace is genuinely on this board: she can see the trip's own lanes.
    await expect(laneNamed(memberPage, "Transport")).toBeVisible();

    // --- and sees no trace of Ada's list ----------------------------------
    // The assertion this whole journey is for. Her column exists — it is
    // everyone's — and it is empty, because it is *hers*.
    const hers = myColumn(memberPage);
    await expect(hers).toBeVisible();
    await expect(
      hers.getByRole("button", { name: /Add something only you pay for/ }),
    ).toBeVisible();

    // Nowhere on her board, in any surface: not the column, not the cost
    // panel, not the timeline.
    await expect(memberPage.getByText(mine)).toHaveCount(0);

    // Her own reading of the cost panel is hers. She has the switch — everyone
    // does — and behind it there is no trace of Ada's money, and no budget:
    // Ada set 400 on this trip and it is not Grace's number to see.
    await memberPage
      .getByRole("group", { name: "Whose money" })
      .getByRole("button", { name: "Mine" })
      .click();
    await expect(memberPage.getByText(mine)).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Set your own budget" }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Change your budget" }),
    ).toHaveCount(0);

    await memberPage.goto(`/trips/${tripId}/timeline`);
    await expect(memberPage.getByText(mine)).toHaveCount(0);

    // --- Grace's own list is her own --------------------------------------
    // Both people now hold an item, and each still sees exactly one.
    await memberPage.goto(`/trips/${tripId}`);
    await hers
      .getByRole("button", { name: /Add something only you pay for/ })
      .click();
    await memberPage.getByLabel("Title").fill("My insurance");
    await memberPage.getByRole("button", { name: "Add item" }).click();
    await expect(hers.getByText("My insurance")).toBeVisible();
    await expect(memberPage.getByText(mine)).toHaveCount(0);

    await ownerPage.reload();
    await expect(myColumn(ownerPage).getByText(mine)).toBeVisible();
    await expect(ownerPage.getByText("My insurance")).toHaveCount(0);
    // ...and her budget survived the round trip, still only on her screen.
    await ownerPage
      .getByRole("group", { name: "Whose money" })
      .getByRole("button", { name: "Mine" })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "Change your budget" }),
    ).toBeVisible();
  } finally {
    await closeGuest();
  }
});
