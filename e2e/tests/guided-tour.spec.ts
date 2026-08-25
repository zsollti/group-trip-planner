import { expect, test } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, seedAndSignInWithTour } from "../support/actions";

/**
 * The guided tour, from the one angle no unit test can reach: does it actually
 * open by itself for a brand-new account, against a real board, in a real
 * browser?
 *
 * Everything else about it is covered cheaper and better elsewhere — the
 * placement arithmetic in `lib/tour.test.ts`, the stepping and the
 * self-skipping in `Tour.test.tsx`. What only a browser can answer is whether
 * the anchors it looks for are still on the page, because that is the failure
 * mode with no symptom: delete a `data-tour` attribute in a tidy-up and the
 * tour simply gets shorter, silently, for everyone.
 *
 * So this asserts the **count**. A board with lanes, cards, a cost panel, a
 * crew, an invite and a chat has all eight steps plus the send-off; if a step
 * has quietly stopped finding its anchor, the number changes and this fails
 * with the number it changed to.
 */

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

test("opens itself for a new account and walks the whole board", async ({
  page,
}) => {
  // The one account in this suite that has *not* been put past the tour — see
  // `createVerifiedUser`, which marks every other seeded user as having seen it
  // so their journeys are not interrupted by a walkthrough.
  await seedAndSignInWithTour(page, "Tourist");
  await createBoard(page, "Tour of Lisbon");

  // It opens on its own, after a beat: most anchors are still fetching on the
  // first paint, and the tour waits for them rather than shrinking to fit.
  const bubble = page.locator(".tour__bubble");
  await expect(bubble).toBeVisible({ timeout: 10_000 });
  await expect(bubble).toContainText("One lane, one question");

  // Every step this board can show, plus the send-off. A freshly created board
  // has lanes and a propose button but no cards yet, so the voting step drops
  // itself — which is the self-skipping rule doing its job in a real page.
  const count = await page.locator(".tour__count").textContent();
  const total = Number(/of (\d+)/.exec(count ?? "")?.[1]);
  expect(total).toBeGreaterThanOrEqual(6);

  for (let i = 1; i < total; i += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(bubble).toContainText("Let the fun begin!");

  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(bubble).toBeHidden();

  // And it stays gone. Reloading is the honest check that the answer was
  // written to the account rather than held in this tab — the whole reason
  // `tourCompletedAt` is a column and not a `localStorage` key.
  await page.reload();
  await expect(page.locator(".lane").first()).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(bubble).toBeHidden();

  // Still offered, though, which is what "skippable but available later" means.
  await page.locator('[data-tour="account"]').click();
  await page.getByRole("button", { name: "Show me around" }).click();
  await expect(bubble).toBeVisible();
});
