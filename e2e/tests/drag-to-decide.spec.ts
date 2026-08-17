import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import {
  createBoard,
  laneNamed,
  settledCard,
  signUpAndIn,
} from "../support/actions";

/**
 * **Drag a card onto its lane's decide strip.**
 *
 * The gesture the product is built around — the README's argument for this UI is
 * that committing to an option is a physical act rather than a form field — and
 * the one thing no cheaper test can reach. jsdom does no layout and dnd-kit
 * needs real pointer geometry, so the board's DOM suite can only assert that the
 * *menu* equivalent exists. It cannot tell you whether the drag works.
 *
 * That gap has already cost once. Moving Decided out of the lane row broke
 * drag-to-decide outright and every test in the repository stayed green: the
 * lane row scrolls horizontally, a box that scrolls on one axis clips on both,
 * and a card dragged upward towards the rail was clipped away while dnd-kit
 * auto-scrolled the row instead of registering the drop target. This spec is
 * what would have caught it.
 *
 * The rail is now gone and the target lives inside the lane, which is a shorter
 * drag that never leaves the scroll container — so that particular failure can
 * no longer happen. The gesture still cannot be checked any other way.
 *
 * **Dragging a decision back out to unlock it went with the rail.** The card's
 * "⋯" menu is now the only way to reopen a decision, so the second test here
 * covers that path end to end instead: the DOM suite can prove the button is
 * there, not that the server accepts what it sends.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

/**
 * A pointer drag dnd-kit will accept, onto a target that does not exist yet.
 *
 * Two things make this fiddly. Playwright's `dragTo` moves in one jump; dnd-kit's
 * PointerSensor needs a 6px activation movement first and then intermediate
 * positions, or it reads the whole thing as a click and no drop is registered.
 * And the decide strip is only rendered **while a card is in hand**, so its box
 * cannot be measured up front — the target is resolved after activation, which
 * is also a real assertion that the strip appears at all.
 */
async function dragOntoDecide(page: Page, grip: Locator, lane: Locator) {
  const from = await grip.boundingBox();
  if (!from) throw new Error("drag source is not laid out");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the activation constraint, without leaving the source yet. The strip
  // renders on this movement.
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 - 12,
    { steps: 4 },
  );

  const target = lane.locator(".lane__decide-drop");
  await expect(target).toBeVisible();
  const to = await target.boundingBox();
  if (!to) throw new Error("decide target is not laid out");

  const cx = to.x + to.width / 2;
  const cy = to.y + to.height / 2;
  await page.mouse.move(cx, cy, { steps: 12 });
  // The collision detection reads the last position, so arriving and settling
  // have to be separate events.
  await page.mouse.move(cx, cy);
  await page.mouse.up();
}

test("an owner locks a decision by dragging a card onto its lane's decide strip", async ({
  page,
}) => {
  const optionTitle = "Night train";
  await signUpAndIn(page, "Ada");
  await createBoard(page, `Drag ${Date.now().toString(36)}`);

  const transport = laneNamed(page, "Transport");
  await transport
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await page.getByLabel("Title").fill(optionTitle);
  await page.getByLabel("Amount (optional)").fill("120");
  await page.getByRole("button", { name: "Propose option" }).click();

  const card = transport.locator(".lane__card", { hasText: optionTitle });
  await expect(card).toBeVisible();
  await expect(settledCard(transport, optionTitle)).toHaveCount(0);
  // The strip is not standing there the rest of the time.
  await expect(transport.locator(".lane__decide-drop")).toHaveCount(0);

  // The grip is the drag handle; the card body is click-to-view.
  await dragOntoDecide(
    page,
    card.getByRole("button", { name: /^Drag /i }),
    transport,
  );

  // Settled in its lane — which is the proof the lock really ran on the server
  // rather than the card merely having been dropped somewhere that looked
  // right: the card only gains that class once the option comes back LOCKED.
  await expect(settledCard(transport, optionTitle)).toBeVisible();
  // And the strip is gone again with the drag that summoned it.
  await expect(transport.locator(".lane__decide-drop")).toHaveCount(0);
});

test("a decision is reopened from the settled card's menu", async ({
  page,
}) => {
  const optionTitle = "Hostel";
  await signUpAndIn(page, "Bea");
  await createBoard(page, `Undo ${Date.now().toString(36)}`);

  const stay = laneNamed(page, "Accommodation");
  await stay
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await page.getByLabel("Title").fill(optionTitle);
  await page.getByRole("button", { name: "Propose option" }).click();

  await stay
    .getByRole("button", {
      name: new RegExp(`actions for ${optionTitle}`, "i"),
    })
    .click();
  // A single-choice lane says "Move to Decided", a multi-select one "Lock
  // card" — the label tells an organizer whether locking this releases a
  // sibling. Which one Accommodation shows is a seeded default that has now
  // moved twice, and it is not what this test is about: the subject is the
  // menu that reopens a decision, and locking is how it gets one to reopen.
  await page
    .getByRole("button", { name: /^(Move to Decided|Lock card)$/ })
    .click();
  await expect(settledCard(stay, optionTitle)).toBeVisible();

  // …and back out again, through the one affordance that reopens a decision.
  await stay
    .getByRole("button", {
      name: new RegExp(`actions for ${optionTitle}`, "i"),
    })
    .click();
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(settledCard(stay, optionTitle)).toHaveCount(0);
  await expect(
    stay.locator(".lane__card", { hasText: optionTitle }),
  ).toBeVisible();
});
