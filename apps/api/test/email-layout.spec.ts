import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmailService } from "../src/email/email.service.js";
import { fine, p, quote, renderEmail } from "../src/email/layout.js";
import type { Env } from "../src/config/env.js";

/**
 * The shape an email arrives in.
 *
 * These are not "does it look nice" tests — that is the owner's eye, not a
 * suite's. They pin the handful of properties that are load-bearing and that a
 * later edit could quietly break while the mail still renders on the machine of
 * whoever made the edit:
 *
 *  - the mark points at an absolute URL, since an inbox has no origin to resolve
 *    a relative one against;
 *  - the button is a table, because an inline `<a>` with padding collapses to a
 *    bare link in Outlook;
 *  - the templates still say what they said — the same prose, now inside markup.
 *
 * The service is exercised without a Resend key, which is how it runs locally:
 * it logs instead of sending. To see the HTML at all, the send is intercepted by
 * standing a fake `Resend` in its place.
 */

const ENV = {
  WEB_APP_URL: "https://trips.example.com",
  API_PUBLIC_URL: "https://api.example.com",
  EMAIL_FROM: "Group Trip Planner <hello@example.com>",
  RESEND_API_KEY: "re_test",
} as unknown as Env;

/** Build a service whose provider records instead of sending. */
function capturing(): {
  service: EmailService;
  sent: { subject: string; html: string; to: string }[];
} {
  const sent: { subject: string; html: string; to: string }[] = [];
  const service = new EmailService(ENV);
  // The client is built in the constructor from the key above; swapping the
  // object is what keeps this test off the network without also skipping the
  // branch that composes the message.
  (service as unknown as { resend: unknown }).resend = {
    emails: {
      send: (message: { subject: string; html: string; to: string }) => {
        sent.push(message);
        return Promise.resolve({});
      },
    },
  };
  return { service, sent };
}

describe("the email layout", () => {
  it("points the mark at an absolute URL on the web app", async () => {
    const { service, sent } = capturing();
    await service.sendVerificationEmail("someone@example.com", "tok");

    assert.equal(sent.length, 1);
    assert.match(
      sent[0]!.html,
      /<img src="https:\/\/trips\.example\.com\/logo-mark\.png"/,
    );
  });

  it("does not double a slash when the app URL carries a trailing one", () => {
    const html = renderEmail({
      webAppUrl: "https://trips.example.com/",
      body: p("hi"),
    });
    assert.match(html, /https:\/\/trips\.example\.com\/logo-mark\.png/);
  });

  it("draws the call to action as a table, not a padded link", async () => {
    const { service, sent } = capturing();
    await service.sendVerificationEmail("someone@example.com", "tok");

    // Outlook's renderer ignores padding on an inline element, so a button
    // built as a bare `<a style="padding:…">` arrives as a plain blue link.
    const html = sent[0]!.html;
    const button = html.slice(html.indexOf("Verify my email") - 400);
    assert.match(button, /bgcolor="#0f766e"/);
    assert.ok(
      html.includes('<table role="presentation"'),
      "the button and the frame are both tables",
    );
  });

  it("still says what each template said", async () => {
    const { service, sent } = capturing();
    await service.sendVerificationEmail("someone@example.com", "tok-1");
    await service.sendInviteEmail("someone@example.com", "tok-2", "Lisbon");
    await service.sendAccountExistsNotice("someone@example.com");

    // The verification mail's own words, which changed post-launch: it thanks
    // you for signing up, tells you what the button is for, and says what to do
    // if you never asked for it.
    assert.match(sent[0]!.html, /Thanks for signing up/);
    assert.match(sent[0]!.html, /Didn't sign up\?/);
    assert.match(
      sent[0]!.html,
      /href="https:\/\/trips\.example\.com\/verify\?token=tok-1"/,
    );
    assert.match(sent[1]!.html, /invited to join "Lisbon"/);
    assert.match(
      sent[1]!.html,
      /href="https:\/\/trips\.example\.com\/join\/tok-2"/,
    );
    // Case-insensitive: the sentence it lives in was split in two, so the
    // phrase now opens one rather than closing the other. What the assertion is
    // for is that the template still says it at all.
    assert.match(sent[2]!.html, /no new account was created/i);
    // The account-exists notice deliberately has no button — see its template.
    assert.doesNotMatch(sent[2]!.html, /bgcolor="#0f766e"/);
  });

  it("keeps escaping a trip name that arrives with markup in it", async () => {
    // The layout is new; this property is not, and it is the one an unrelated
    // refactor is most likely to drop. The name comes from whoever created the
    // trip and the mail goes out from our own domain.
    const { service, sent } = capturing();
    await service.sendInviteEmail(
      "someone@example.com",
      "tok",
      '<img src=x onerror="alert(1)">',
    );
    assert.doesNotMatch(sent[0]!.html, /<img src=x/);
    assert.match(sent[0]!.html, /&lt;img src=x/);
  });

  it("puts the unsubscribe line outside the card, and keeps it a link", async () => {
    const { service, sent } = capturing();
    await service.sendMentionEmail({
      to: "someone@example.com",
      tripName: "Lisbon",
      actorName: "Mira",
      excerpt: "are we booking the ferry?",
      tripId: "trip-1",
      unsubscribeToken: "unsub",
      locale: "en",
    });

    const html = sent[0]!.html;
    assert.match(html, /are we booking the ferry\?/);
    assert.match(
      html,
      /href="https:\/\/api\.example\.com\/email\/unsubscribe\?token=unsub"/,
    );
    // Small print after the card closes, not inside it.
    assert.ok(
      html.indexOf("mention email is on") >
        html.lastIndexOf("</td></tr>") - 400,
    );
  });
});

describe("the layout's pieces", () => {
  it("gives every paragraph the same type, so no template invents its own", () => {
    assert.match(p("x"), /font-size:15px/);
    assert.match(quote("x"), /border-left/);
    assert.match(fine("x"), /font-size:12px/);
  });

  it("emits a fragment, not a second HTML document", () => {
    // Resend wraps what it is given; a nested <html> is how a client ends up
    // rendering the whole message with its own defaults instead.
    const html = renderEmail({ webAppUrl: "https://x.example", body: p("hi") });
    assert.doesNotMatch(html, /<html|<body|<!doctype/i);
  });
});
