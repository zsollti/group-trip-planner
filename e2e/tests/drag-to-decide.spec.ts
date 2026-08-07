import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import {
  createBoard,
  decidedRail,
  laneNamed,
  signUpAndIn,
} from "../support/actions";

/**
 * **Drag a card onto Decided.**
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
 * auto-scrolled the row instead of registering the drop target. The fix is a
 * `DragOverlay` plus pointer-first collision detection. This spec is what would
 * have caught it.
 *
 * Both directions are covered, because they fail for different reasons: dragging
 * *in* crosses out of the scroll container, dragging *out* crosses into it.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

/**
 * A pointer drag dnd-kit will accept.
 *
 * Playwright's `dragTo` moves in one jump; dnd-kit's PointerSensor needs a
 * 6px activation movement first and then intermediate positions, or it treats
 * the whole thing as a click and no drop is ever registered. The final pair of
 * moves matters too — the collision detection reads the last position, so
 * arriving and settling are separate events.
 */
async function dragOnto(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target is not laid out");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the activation constraint, without leaving the source yet.
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 - 12,
    {
      steps: 4,
    },
  );
  const cx = to.x + to.width / 2;
  const cy = to.y + to.height / 2;
  await page.mouse.move(cx, cy, { steps: 12 });
  await page.mouse.move(cx, cy);
  await page.mouse.up();
}

test("an owner locks a decision by dragging a card onto the Decided rail", async ({
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
  const rail = decidedRail(page);
  await expect(rail.getByText(optionTitle)).toHaveCount(0);

  // The grip is the drag handle; the card body is click-to-view.
  await dragOnto(page, card.getByRole("button", { name: /^Drag /i }), rail);

  // In the rail, and marked settled back in its lane. Both together are the
  // proof that the lock really ran on the server, rather than the card merely
  // having been dropped somewhere that looked right — the lane card only gains
  // that class once the option comes back LOCKED.
  await expect(rail.getByText(optionTitle)).toBeVisible();
  await expect(
    transport.locator(".lane__card--settled", { hasText: optionTitle }),
  ).toBeVisible();
});

test("dragging a decision off the rail unlocks it back into its lane", async ({
  page,
}) => {
  const optionTitle = "Hostel";
  await signUpAndIn(page, "Bea");
  await createBoard(page, `Undrag ${Date.now().toString(36)}`);

  const stay = laneNamed(page, "Accommodation");
  await stay
    .getByRole("button", { name: "＋ Propose the first option" })
    .click();
  await page.getByLabel("Title").fill(optionTitle);
  await page.getByRole("button", { name: "Propose option" }).click();

  const rail = decidedRail(page);
  await dragOnto(
    page,
    stay
      .locator(".lane__card", { hasText: optionTitle })
      .getByRole("button", { name: /^Drag / }),
    rail,
  );
  await expect(rail.getByText(optionTitle)).toBeVisible();

  // …and back out again. Anywhere outside the rail unlocks; the lane it came
  // from is the honest place for a user to aim.
  await dragOnto(page, rail.getByRole("button", { name: /^Drag / }), stay);

  await expect(stay.getByText(optionTitle)).toBeVisible();
  await expect(stay.locator(".lane__card--settled")).toHaveCount(0);
  await expect(rail.getByText(optionTitle)).toHaveCount(0);
});
