import { expect, type Locator, type Page } from "@playwright/test";
import { createVerifiedUser, e2eEmail, markVerified } from "./db";

/** An account this run created, so a later step can sign back in as them. */
export interface Account {
  email: string;
  password: string;
  displayName: string;
}

const PASSWORD = "e2e-password-123";

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
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
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
  await expect(
    page.getByRole("heading", { name: `Welcome, ${account.displayName}` }),
  ).toBeVisible();
}

/**
 * Create a board and land on it. Returns the trip id from the URL, which is the
 * only identifier a later step needs.
 */
export async function createBoard(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "＋ New board" }).click();
  await page.getByLabel("Trip name").fill(name);
  await page.getByLabel("Destination").fill("Lisbon, Portugal");
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

/** The Decided rail — locked picks across every lane, above the lanes. */
export function decidedRail(page: Page): Locator {
  return page.getByRole("region", { name: "Decided" });
}
