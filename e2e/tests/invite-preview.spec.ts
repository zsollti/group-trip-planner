import { expect, test, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, laneNamed, seedAndSignIn } from "../support/actions";

/**
 * **An invite link, opened by somebody with no account.**
 *
 * The claim this journey exists for cannot be checked from a signed-in page:
 * that a browser carrying **no session at all** can be shown a real board, and
 * shown nothing on it that it could act on. Unit tests can assert both against a
 * mocked payload; only a second browser context with empty storage can prove
 * that the page renders without an access token, that the API answers it
 * unauthenticated, and that the link still redeems afterwards.
 *
 * It walks what the person actually does: opens the link cold, reads what they
 * have been invited to, then signs in from that page and lands on the board as
 * a member.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

/** Mint a global invite link and read it back out of the clipboard. */
async function copyInviteLink(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole("button", { name: "Close" }).click();
  return url;
}

test("a link shows the trip to someone who has not signed in, and still joins", async ({
  page: ownerPage,
  context: ownerContext,
  browser,
}) => {
  const tripName = `Preview Trip ${Date.now()}`;
  const optionTitle = "Night train";

  await seedAndSignIn(ownerPage, "Ada");
  await createBoard(ownerPage, tripName);
  const tripId = ownerPage.url().split("/trips/")[1]!;

  // Something on the board worth previewing.
  const transport = laneNamed(ownerPage, "Transport");
  await transport
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await ownerPage.getByLabel("Title").fill(optionTitle);
  await ownerPage.getByLabel("Amount").fill("120");
  await ownerPage.getByRole("button", { name: "Propose option" }).click();
  await expect(transport.getByText(optionTitle)).toBeVisible();

  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const joinUrl = await copyInviteLink(ownerPage);

  // --- a browser with no session opens the link ----------------------------
  // A fresh context, so there is no token, no cookie and no cache to fall back
  // on. This is the whole point: everything below is answered to nobody.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    await visitor.goto(joinUrl);

    // The trip, not a login form.
    await expect(
      visitor.getByRole("heading", { name: tripName, level: 1 }),
    ).toBeVisible();
    // The board itself: the lane, what has been proposed in it, and who is
    // already going.
    await expect(visitor.getByText("Transport")).toBeVisible();
    await expect(visitor.getByText(optionTitle)).toBeVisible();
    await expect(visitor.getByText("Ada")).toBeVisible();

    // And nothing to act on. The board's own controls are the ones that would
    // need a session, and a preview that offered any of them would be offering
    // it to a stranger.
    await expect(visitor.getByRole("button", { name: /Vote/ })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: "Invite" })).toHaveCount(
      0,
    );
    await expect(visitor.getByRole("button", { name: /Propose/ })).toHaveCount(
      0,
    );

    // --- and the link still redeems -------------------------------------
    // Signing in from here carries the token, so the way in from a preview is
    // the same way in the redirect used to take. Seeded rather than registered
    // through the form, which is the suite's usual trade (see `seedAndSignIn`)
    // — what is being proved is that the token survived the round trip, not
    // that the sign-up form works.
    await seedAndSignIn(visitor, "Grace");
    await visitor.goto(joinUrl);
    await visitor.waitForURL(`**/trips/${tripId}`);
    await expect(
      visitor.getByRole("region", { name: "Crew" }).getByText("Grace"),
    ).toBeVisible();
  } finally {
    await visitorContext.close();
  }
});
