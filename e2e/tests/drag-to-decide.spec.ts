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
 * **Dragging a decision back out is a gesture again.** It went with the rail,
 * leaving a card that could be locked with the mouse and unlocked only from a
 * menu; it is back as a second strip, inside the lane the card is already in,
 * below the decisions and above the candidates. It needs this file for exactly
 * the reason the first gesture does — the strip is rendered only while a card
 * is in hand, so nothing without layout and real pointer geometry can see it.
 *
 * The menu path stays covered too. Drag is the second way to do a thing here,
 * never the only one, and the DOM suite can prove the button is there but not
 * that the server accepts what it sends.
 */

test.describe.configure({ mode: "serial" });

/**
 * The two strips. One class, one modifier — they are the same drop target
 * dressed as the thing the card is about to become, which is what lets them sit
 * an inch apart in one column without being read as the same target.
 */
const LOCK_STRIP = ".lane__decide-drop:not(.lane__decide-drop--unlock)";
const UNLOCK_STRIP = ".lane__decide-drop--unlock";

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
 * And a strip is only rendered **while a card is in hand**, so its box cannot be
 * measured up front — the target is resolved after activation, which is also a
 * real assertion that the strip appears at all.
 *
 * `strip` says which of the two: the lock strip above the decisions, or the
 * unlock strip below them. They are the same object pointing opposite ways, and
 * a lane never offers both at once — the card in hand is either locked or it is
 * not.
 */
async function dragOntoStrip(
  page: Page,
  grip: Locator,
  lane: Locator,
  strip: string,
) {
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

  const target = lane.locator(strip);
  await expect(target).toBeVisible();
  const to = await target.boundingBox();
  if (!to) throw new Error("drop target is not laid out");

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
  await page.getByLabel("Amount").fill("120");
  await page.getByRole("button", { name: "Propose option" }).click();

  const card = transport.locator(".lane__card", { hasText: optionTitle });
  await expect(card).toBeVisible();
  await expect(settledCard(transport, optionTitle)).toHaveCount(0);
  // The strip is not standing there the rest of the time.
  await expect(transport.locator(".lane__decide-drop")).toHaveCount(0);

  // The grip is the drag handle; the card body is click-to-view.
  await dragOntoStrip(
    page,
    card.getByRole("button", { name: /^Drag /i }),
    transport,
    LOCK_STRIP,
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
  // `exact`, because Playwright matches an accessible name by substring and a
  // settled card now has two controls with "unlock" in theirs: the menu item,
  // and the grip that says which drop reopens the decision.
  await page.getByRole("button", { name: "Unlock", exact: true }).click();

  await expect(settledCard(stay, optionTitle)).toHaveCount(0);
  await expect(
    stay.locator(".lane__card", { hasText: optionTitle }),
  ).toBeVisible();
});

test("an owner reopens a decision by dragging it onto its lane's unlock strip", async ({
  page,
}) => {
  const optionTitle = "Beach house";
  await signUpAndIn(page, "Cleo");
  await createBoard(page, `Unlock ${Date.now().toString(36)}`);

  const stay = laneNamed(page, "Accommodation");
  await stay
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await page.getByLabel("Title").fill(optionTitle);
  await page.getByRole("button", { name: "Propose option" }).click();

  // Locked from the menu: the subject here is the gesture that undoes it, and
  // the drag that locks is already covered above.
  await stay
    .getByRole("button", {
      name: new RegExp(`actions for ${optionTitle}`, "i"),
    })
    .click();
  await page
    .getByRole("button", { name: /^(Move to Decided|Lock card)$/ })
    .click();
  const settled = settledCard(stay, optionTitle);
  await expect(settled).toBeVisible();
  // Neither strip stands there the rest of the time.
  await expect(stay.locator(UNLOCK_STRIP)).toHaveCount(0);

  // A decision has a grip of its own now, and it is the only gesture it has:
  // dropped anywhere but the strip, the card goes back.
  await dragOntoStrip(
    page,
    settled.getByRole("button", { name: /^Drag /i }),
    stay,
    UNLOCK_STRIP,
  );

  // Back among the candidates — which is the proof the unlock ran on the
  // server, not that the card was merely dropped somewhere that looked right.
  await expect(settledCard(stay, optionTitle)).toHaveCount(0);
  await expect(
    stay.locator(".lane__card", { hasText: optionTitle }),
  ).toBeVisible();
  await expect(stay.locator(UNLOCK_STRIP)).toHaveCount(0);
});
