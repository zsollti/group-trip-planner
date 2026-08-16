import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { cleanupE2EData, disconnect } from "../support/db";
import { createBoard, seedAndSignIn } from "../support/actions";

/**
 * **The Phase-4.4 reconnect-recovery journey (Phase 7.4 DoD).**
 *
 * Chat is delivered over a socket, so a message sent while a member's connection
 * is down never reaches their open page. The hybrid recovery covers that: on
 * reconnect the client asks the REST history for everything **since** the last
 * message it holds and merges the gap in. Nothing below the browser can test
 * this — the API suite can prove the `since` endpoint returns the right rows,
 * but not that a real client asks for them at the right moment, or that the
 * merge leaves the transcript in one piece.
 *
 * The drop is produced by routing the WebSocket rather than by taking the browser
 * offline — see the note at the interception below for why.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EData();
  await disconnect();
});

/** Open the chat panel and wait for it to be interactive. */
async function openChat(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Chat/ }).click();
  await expect(page.getByRole("dialog", { name: "Trip chat" })).toBeVisible();
}

/**
 * The board's live-connection state, as the app publishes it.
 *
 * This used to be read off the word "Live" in the header. That badge is gone —
 * a green light confirming that a working board works — but the state behind it
 * is what this journey has to synchronise on, so the board carries it as an
 * attribute instead. Reading the attribute is also strictly better than reading
 * the label was: it cannot be satisfied by the word appearing anywhere else on
 * the page, and it distinguishes "connecting" from "connected", which the
 * absence of a label never could.
 */
function socketStatus(page: Page) {
  return page.locator("header.board__bar");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  // By role, not by label: "Message" also matches the "Delete message" button
  // that appears on the caller's own messages once they have sent one.
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a member who drops offline gets the messages they missed on reconnect", async ({
  page: ownerPage,
  context: ownerContext,
  browser,
}) => {
  await seedAndSignIn(ownerPage, "Barbara");
  const tripId = await createBoard(ownerPage, `Reconnect ${Date.now()}`);

  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  await ownerPage.getByRole("button", { name: "Create link" }).click();
  await ownerPage.getByRole("button", { name: "Copy link" }).click();
  const joinUrl = await ownerPage.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await ownerPage.getByRole("button", { name: "Close" }).click();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    // Cutting the *browser's* network does not drop this connection: the client
    // opens a pure WebSocket (`transports: ["websocket"]`), and an established
    // socket survives `setOffline` until Socket.IO's ping timeout notices —
    // some forty-five seconds later. Routing the WebSocket instead severs it the
    // instant the test asks, and lets the test decide when reconnecting starts
    // working again, which is the whole shape of the scenario.
    //
    // The route is held in a box rather than a plain `let` because its only
    // assignment happens inside the handler, which would otherwise leave
    // TypeScript narrowing the variable to `null` at every later read.
    const live: { route: WebSocketRoute | null } = { route: null };
    let refuseSocket = false;
    await memberPage.routeWebSocket(/socket\.io/, (ws) => {
      if (refuseSocket) {
        ws.close();
        return;
      }
      ws.connectToServer();
      live.route = ws;
    });

    await seedAndSignIn(memberPage, "Alan");
    await memberPage.goto(joinUrl);
    await memberPage.waitForURL(`**/trips/${tripId}`);

    await openChat(ownerPage);
    await openChat(memberPage);
    // **Both** sockets, not just the member's. The baseline message below is
    // sent by the member and asserted on the owner's screen, so an owner who has
    // not finished joining the trip room yet simply misses it — an intermittent
    // failure with nothing wrong in the application. Waiting on the indicator
    // the app already publishes is the fix; the drop below is what this journey
    // is actually about.
    await expect(socketStatus(memberPage)).toHaveAttribute(
      "data-socket-status",
      "connected",
    );
    await expect(socketStatus(ownerPage)).toHaveAttribute(
      "data-socket-status",
      "connected",
    );

    // A baseline message, so the client has a last-seen id to catch up from —
    // the anchor the recovery is built on.
    await sendMessage(memberPage, "before the drop");
    await expect(ownerPage.getByText("before the drop")).toBeVisible();

    // --- the member loses their connection ---------------------------------
    // Asserting "no longer connected" rather than any particular state: a drop
    // starts Socket.IO's own bounded reconnection, which the hook reports as
    // `connecting`, and it only becomes `error` once those attempts are
    // exhausted. Naming either one would make this a test of the retry state
    // machine instead of of recovery.
    refuseSocket = true;
    live.route?.close();
    await expect(socketStatus(memberPage)).not.toHaveAttribute(
      "data-socket-status",
      "connected",
    );

    // --- the group carries on without them ---------------------------------
    await sendMessage(ownerPage, "while you were away");
    await sendMessage(ownerPage, "and one more");
    await expect(ownerPage.getByText("and one more")).toBeVisible();
    // The offline page genuinely did not receive them.
    await expect(memberPage.getByText("while you were away")).toHaveCount(0);

    // --- the connection comes back -----------------------------------------
    // Socket.IO's reconnection is bounded (five attempts with backoff), so the
    // outage above is deliberately short: this journey is about recovering from
    // a transient drop, which is what that bound is designed for.
    refuseSocket = false;
    await expect(socketStatus(memberPage)).toHaveAttribute(
      "data-socket-status",
      "connected",
    );

    // The gap is filled without a reload, in order, and the message that was
    // already on screen is not duplicated by the catch-up.
    await expect(memberPage.getByText("while you were away")).toBeVisible();
    await expect(memberPage.getByText("and one more")).toBeVisible();
    await expect(memberPage.getByText("before the drop")).toHaveCount(1);

    // --- and the recovered client is live again, not merely caught up ------
    // A page that refilled its history but never rebound its socket would pass
    // every assertion above and still be dead.
    //
    // The reply deliberately shares no words with the question. `getByText` is
    // a substring match, so an answer of "still here" would also match the
    // owner's own "still here?" already on their page — the assertion would
    // pass without the reply ever arriving, and would only start *failing*
    // (as a strict-mode violation) once the feature it tests began working.
    await sendMessage(ownerPage, "still here?");
    await expect(memberPage.getByText("still here?")).toBeVisible();
    await sendMessage(memberPage, "back and talking");
    await expect(ownerPage.getByText("back and talking")).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
