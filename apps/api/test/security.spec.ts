import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateOptionInput, isHttpUrl } from "@gtp/types";

/**
 * The pure half of the Phase-7.2 sweep: the two input rules that were found
 * missing during the OWASP pass. Both are boundary rules, so both are testable
 * without a database.
 */

describe("option URL scheme (XSS boundary)", () => {
  /**
   * The reason this rule exists: `z.string().url()` is a *parse* check, not a
   * scheme check — it delegates to `new URL()`, which accepts any scheme it can
   * parse. The value ends up in an `href` on the board, so left alone the
   * contract would happily store `javascript:` and `data:` payloads.
   */
  /** A minimal valid option body, so any rejection below is attributable to the
   *  URL alone rather than to some other missing field. */
  const option = (url: string) => ({
    title: "Hotel",
    currency: "EUR",
    url,
  });

  it("rejects the schemes that turn an href into script", () => {
    for (const url of [
      "javascript:alert(document.cookie)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const parsed = CreateOptionInput.safeParse(option(url));
      assert.equal(parsed.success, false, `should reject ${url}`);
      assert.ok(
        !parsed.success &&
          parsed.error.issues.some((issue) => issue.path[0] === "url"),
        `${url} must be rejected *for its url*, not incidentally`,
      );
    }
  });

  it("still accepts the ordinary links people actually paste", () => {
    for (const url of [
      "https://booking.example/rooms/12?ref=a#deck",
      "http://localhost:8080/x",
    ]) {
      const parsed = CreateOptionInput.safeParse(option(url));
      assert.equal(parsed.success, true, `should accept ${url}`);
    }
  });

  it("isHttpUrl guards the render side against rows stored before the rule", () => {
    // Tightening the schema only governs new writes; anything already in the
    // database has to be judged again at the point it becomes a link.
    assert.equal(isHttpUrl("https://example.com"), true);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("not a url at all"), false);
    assert.equal(isHttpUrl("//example.com"), false);
  });
});

describe("invite email escaping", () => {
  /**
   * The invite mail interpolates a user-chosen trip name into HTML and is
   * delivered to an address the inviter types — so an unescaped name is a way
   * to compose arbitrary markup inside mail sent from our own domain. The
   * mention email (Phase 5.2) escaped; this one had been missed.
   *
   * Asserted through the rendered payload the service hands the provider, so
   * the test fails if the escaping is removed rather than merely moved.
   */
  it("escapes a trip name carrying markup", async () => {
    const sent: { html?: string }[] = [];
    const { EmailService } = await import("../src/email/email.service.js");
    const service = new EmailService({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "test@example.com",
      WEB_APP_URL: "https://board.example",
    } as never);
    // Stand in for the provider client the constructor built.
    (service as unknown as { resend: unknown }).resend = {
      emails: {
        send: (payload: { html?: string }) => {
          sent.push(payload);
          return Promise.resolve();
        },
      },
    };

    await service.sendInviteEmail(
      "victim@example.com",
      "raw-token",
      `Lisbon<a href="https://phish.example">click</a>`,
    );

    const html = sent[0]?.html ?? "";
    assert.ok(html.length > 0, "an email was sent");
    assert.ok(
      !html.includes(`<a href="https://phish.example"`),
      "injected anchor must not survive into the body",
    );
    assert.ok(
      html.includes("&lt;a href=&quot;https://phish.example&quot;&gt;"),
      "the markup is escaped, not stripped",
    );
    // The real invite link is still a working anchor.
    assert.ok(html.includes(`<a href="https://board.example/join/raw-token">`));
  });
});
