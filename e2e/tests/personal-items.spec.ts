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
 * the column, switch the cost panel to their own reading, and confirm the
 * target verdict did **not** move — the owner's decision, checked on the
 * surface that states it rather than in the module that computes it.
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
  return page.getByRole("region", { name: "Just for me" });
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

  // --- the cost panel gains a second reading -------------------------------
  // Offered only now: before there was anything of her own, "Mine" would have
  // differed from "The trip" by nothing worth a control.
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
    // And no switch, since she has nothing of her own to switch to — which is
    // also a second way of saying the server sent her no private money.
    await expect(
      memberPage.getByRole("group", { name: "Whose money" }),
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
  } finally {
    await closeGuest();
  }
});
