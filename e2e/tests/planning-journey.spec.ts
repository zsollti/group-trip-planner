import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import {
  createBoard,
  decidedRail,
  laneNamed,
  seedAndSignIn,
  signUpAndIn,
} from "../support/actions";

/**
 * **The core journey (Phase 7.4 DoD):** register → create trip → invite → join →
 * propose → vote → lock.
 *
 * Two real browser contexts, because the point of the product is that two people
 * plan together: an owner and an invited participant, each with their own
 * session, cookies and socket. The trip is created by one and changed by the
 * other, and the assertions are made on whichever screen a real user would be
 * looking at — including the participant's board updating **without a reload**,
 * which is the only place the live socket, the board sync and the REST write are
 * proved to agree.
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

test("a group plans a trip end to end: invite, join, propose, vote, lock", async ({
  page: ownerPage,
  context: ownerContext,
  browser,
}) => {
  const tripName = `Lisbon ${Date.now().toString(36)}`;
  const optionTitle = "Night train";

  // --- the owner signs up and opens a board --------------------------------
  await signUpAndIn(ownerPage, "Ada");
  const tripId = await createBoard(ownerPage, tripName);

  // The seeded lanes are there — this is the board a new trip actually gets.
  await expect(laneNamed(ownerPage, "Transport")).toBeVisible();
  await expect(decidedRail(ownerPage)).toBeVisible();

  // --- the owner mints an invite link --------------------------------------
  // Reading the copied link back is the honest test of the affordance: the token
  // never appears on screen, so clipboard is the only route a real user has.
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  await ownerPage.getByRole("button", { name: "Create link" }).click();
  await ownerPage.getByRole("button", { name: "Copy link" }).click();
  await expect(
    ownerPage.getByRole("button", { name: "Copied!" }),
  ).toBeVisible();
  const joinUrl = await ownerPage.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(joinUrl).toContain("/join/");
  await ownerPage.getByRole("button", { name: "Close" }).click();

  // --- a second person joins through that link -----------------------------
  const guestContext = await browser.newContext();
  const { page: memberPage, close: closeGuest } =
    await secondBrowser(guestContext);
  try {
    await seedAndSignIn(memberPage, "Grace");
    await memberPage.goto(joinUrl);

    // Redemption lands them on the board itself, as a member.
    await memberPage.waitForURL(`**/trips/${tripId}`);
    await expect(
      memberPage.getByRole("heading", { name: tripName, level: 1 }),
    ).toBeVisible();
    await expect(memberPage.getByText("Participant")).toBeVisible();

    // --- the participant proposes an option --------------------------------
    const memberTransport = laneNamed(memberPage, "Transport");
    await memberTransport
      .getByRole("button", { name: "＋ Propose the first option" })
      .click();
    await memberPage.getByLabel("Title").fill(optionTitle);
    await memberPage.getByLabel("Amount (optional)").fill("120");
    await memberPage.getByRole("button", { name: "Propose option" }).click();

    await expect(memberTransport.getByText(optionTitle)).toBeVisible();

    // --- it reaches the owner's open board live ----------------------------
    // No reload: the proposal was pushed over the trip socket and the board
    // refetched itself. This is the assertion that fails if the realtime layer
    // silently stops working — everything else here would still pass.
    const ownerTransport = laneNamed(ownerPage, "Transport");
    await expect(ownerTransport.getByText(optionTitle)).toBeVisible();

    // --- the owner votes ---------------------------------------------------
    const ownerCard = ownerTransport.locator(".lane__card", {
      hasText: optionTitle,
    });
    await ownerCard.getByRole("button", { name: "○ Vote" }).click();
    await expect(
      ownerCard.getByRole("button", { name: "● Voted" }),
    ).toBeVisible();
    await expect(
      ownerCard.getByRole("button", { name: "● Voted" }),
    ).toHaveAttribute("aria-pressed", "true");

    // --- the owner locks the decision --------------------------------------
    // Every category seeds single-choice now, so the action reads "Move to
    // Decided"; a lane widened to multi-select offers "Lock card" instead. The
    // exact label is asserted rather than matched loosely — it is the sentence
    // that tells an organizer whether locking this will release a sibling.
    await ownerCard
      .getByRole("button", { name: `Actions for ${optionTitle}` })
      .click();
    await ownerPage.getByRole("button", { name: "Move to Decided" }).click();

    // The decision leaves its lane and lands in the Decided rail.
    const ownerDecided = decidedRail(ownerPage);
    await expect(ownerDecided.getByText(optionTitle)).toBeVisible();
    // The chip names both the lane the decision answers and who called it. The
    // separator between them is a CSS pseudo-element and deliberately absent
    // here: a screen reader should not be read a punctuation mark.
    await expect(ownerDecided.getByText("Transport")).toBeVisible();
    await expect(ownerDecided.getByText("Ada")).toBeVisible();
    // It stays in its lane too, now marked settled — the lane is where you see
    // what the group chose *over what*, so the winner leaving was backwards.
    await expect(
      ownerTransport.locator(".lane__card--settled", { hasText: optionTitle }),
    ).toBeVisible();

    // …and the participant sees the decision without touching anything.
    await expect(decidedRail(memberPage).getByText(optionTitle)).toBeVisible();

    // --- the boards overview reflects the finished decision ----------------
    await ownerPage.getByRole("link", { name: "‹ Boards" }).click();
    const tile = ownerPage.getByRole("link", { name: new RegExp(tripName) });
    await expect(tile).toBeVisible();

    // The reload is not incidental. Tiles come from a query with a 30-second
    // `staleTime`, and the join and the lock both happened *in another browser*,
    // so this client had nothing to invalidate on: for up to half a minute a
    // soft navigation back here legitimately shows the figures it last fetched.
    // Reloading is what a person does, and it is what makes this an assertion
    // about the server's numbers rather than about the cache.
    await ownerPage.reload();
    await expect(tile).toContainText("2 members");
    // €120 per person × 2 people, committed because the option is locked — the
    // cost engine, the headcount resolution and the lock, end to end.
    await expect(tile).toContainText("240");
  } finally {
    await closeGuest();
  }
});

test("a non-member cannot open the board by its URL", async ({ browser }) => {
  // The IDOR spine has an exhaustive API-level sweep; this is the one-line
  // browser confirmation that the refusal reaches the user as a refusal, rather
  // than an empty board that looks like a loading bug.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await seedAndSignIn(ownerPage, "Edsger");
  const tripId = await createBoard(ownerPage, `Private ${Date.now()}`);
  await ownerContext.close();

  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await seedAndSignIn(strangerPage, "Mallory");
  await strangerPage.goto(`/trips/${tripId}`);
  await expect(
    strangerPage.getByText("That board doesn't exist or you're not a member."),
  ).toBeVisible();
  await strangerContext.close();
});
