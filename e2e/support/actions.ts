import { expect, type Locator, type Page } from "@playwright/test";
import { createVerifiedUser, e2eEmail, markVerified } from "./db";

/** An account this run created, so a later step can sign back in as them. */
export interface Account {
  email: string;
  password: string;
  displayName: string;
}

/**
 * One password for every account a run creates, and it clears the sign-up
 * policy on purpose: registration now wants a lowercase letter, an uppercase
 * one, a number and a symbol (`@gtp/types` `passwordRules`), so a fixture that
 * did not would fail at the first form rather than at the thing under test.
 */
const PASSWORD = "E2e-Journey9!";

/**
 * Sign in an account that was seeded rather than registered through the form —
 * the cheap way to add a second person to a scenario. See `createVerifiedUser`
 * for why registering everybody through the UI would fight the rate limiter.
 */
export async function seedAndSignIn(
  page: Page,
  displayName: string,
): Promise<Account> {
  const { email } = await createVerifiedUser(displayName, PASSWORD);
  const account = { email, password: PASSWORD, displayName };
  await signIn(page, account);
  return account;
}

/**
 * Register through the real form, verify the address, and sign in — the front
 * door, not a seeded session. Registration deliberately does not log anyone in
 * (it returns only "verification sent", so the response cannot reveal whether an
 * address already existed), which is why signing in is a separate step here too.
 */
export async function signUpAndIn(
  page: Page,
  displayName: string,
): Promise<Account> {
  const email = e2eEmail(displayName.toLowerCase());

  await page.goto("/register");
  await page.getByLabel("Nickname").fill(displayName);
  await page.getByLabel("Email").fill(email);
  // `exact` on both: the form has "Password" and "Password again", and the
  // default substring match would find two boxes and refuse to fill either.
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();

  // Stand in for clicking the emailed link — see the note in support/db.ts.
  await markVerified(email);

  await signIn(page, { email, password: PASSWORD, displayName });
  return { email, password: PASSWORD, displayName };
}

/** Sign in and wait for the boards overview to greet this account by name. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The overview's heading no longer names the reader — the account menu two
  // inches to the right of it already does. It is still the one heading that
  // only appears once a session exists, which is what this is waiting for.
  await expect(
    page.getByRole("heading", { name: "Welcome on board! :)" }),
  ).toBeVisible();
}

/**
 * Create a board and land on it. Returns the trip id from the URL, which is the
 * only identifier a later step needs.
 *
 * `dates` fills the optional range on the create form (`YYYY-MM-DD` each). They
 * must be in the future — the same write-back rule that guards locking a Dates
 * option validates them here, and a past start is refused.
 */
export async function createBoard(
  page: Page,
  name: string,
  dates?: { start: string; end: string },
): Promise<string> {
  // One way in, now that the onboarding panel and its rival CTA are gone: the
  // ghost tile at the end of the wall, which a brand-new account with no boards
  // also gets as the wall's only tile.
  await page.getByRole("button", { name: "＋ New board" }).click();

  // The create form is a stepper now: one question per panel, so this walks it.
  // The primary button says Skip until a question is answered and Next after,
  // which is why it is matched by role rather than by a fixed label.
  const onward = page.getByRole("button", { name: /^(Next|Skip)$/ });
  await page.getByLabel("Trip name").fill(name);
  await onward.click();

  // Typed rather than chosen from the list, which is the case worth exercising
  // here: a destination the gazetteer never saw still has to make a trip.
  await page.getByLabel("Destination").fill("Lisbon, Portugal");
  /*
   * Dismiss the suggestion list, if this database has one to offer.
   *
   * It is absolutely positioned over whatever is under the field — including
   * this step's own button — so where `places:seed` has run, the click below
   * would land on a suggestion instead of on Next. CI never seeds it and a
   * developer's machine usually has, which is the worst polarity a flake can
   * have.
   *
   * **By clicking the heading, not by pressing Escape.** Escape was the first
   * attempt and it closed the entire dialog: the field only swallows Escape
   * while its list is open, and with no list the key travels up to the modal,
   * which is exactly what a modal should do with it. A click outside the field
   * closes the list when there is one and does nothing at all when there is not.
   */
  await page.getByRole("dialog").getByRole("heading").first().click();
  await onward.click();

  if (dates) {
    // Clicked, not typed: the date inputs are gone and the calendar is the
    // control. It opens on the current month and draws two, so a near-future
    // range is usually on screen; page forward when it is not.
    for (const iso of [dates.start, dates.end]) {
      const cell = page.locator(`.drange__day[data-day="${iso}"]`);
      for (let i = 0; i < 6 && (await cell.count()) === 0; i += 1) {
        await page.getByRole("button", { name: "Next month" }).click();
      }
      await cell.first().click();
    }
  }
  await onward.click();
  // Currency keeps its default; budget is left unset.
  await onward.click();
  await page.getByRole("button", { name: "Create board" }).click();

  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
  return page.url().split("/trips/")[1]!;
}

/**
 * One category lane, located as the landmark it now is.
 *
 * This used to filter `section.lane` by its heading — the suite's one structural
 * coupling to a class name — because the lane carried no accessible name. It
 * does now (`aria-labelledby` on its heading), which the helper always
 * anticipated, so the coupling is gone.
 */
export function laneNamed(page: Page, name: string): Locator {
  return page.getByRole("region", { name });
}

/** The crew panel in the summary band — who is on this trip. */
export function crewPanel(page: Page): Locator {
  return page.getByRole("region", { name: "Crew" });
}

/**
 * A lane's settled answer — the card a decision becomes once it is locked.
 *
 * This used to be `decidedRail(page)`: a decision left its lane for a rail
 * above the board, and that rail was where a journey looked for it. The rail is
 * gone (it was a second copy of every decision, directly above the first), so a
 * decision is found where it was made.
 */
export function settledCard(lane: Locator, title: string): Locator {
  return lane.locator(".lane__card--settled", { hasText: title });
}
