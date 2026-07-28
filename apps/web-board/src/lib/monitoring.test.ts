import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { scrubEvent } from "./monitoring";

/**
 * What must never leave the browser (Phase 7.5).
 *
 * Two of this app's URLs *are* credentials: `/join/:token` grants trip
 * membership to whoever opens it, and `/verify?token=…` verifies an address.
 * Sentry attaches the current URL to an event and records navigations as
 * breadcrumbs, so an unrelated render crash on an invite page would otherwise
 * hand a working invite to a third-party service — and to anyone with access
 * to the Sentry project.
 *
 * This is tested rather than trusted because the failure is invisible: the app
 * behaves identically either way, and the leak is only ever visible in someone
 * else's dashboard.
 */

/** A minimal event shaped like the ones the SDK builds. */
function eventWithUrl(url: string): ErrorEvent {
  return { type: undefined, request: { url } } as ErrorEvent;
}

describe("scrubEvent", () => {
  it("redacts an invite token from the request url", () => {
    const scrubbed = scrubEvent(
      eventWithUrl("https://board.example.com/join/RtEr8xQ2kLmN"),
    );
    expect(scrubbed.request?.url).toBe(
      "https://board.example.com/join/[token]",
    );
  });

  it("redacts a verification token from the query string", () => {
    const scrubbed = scrubEvent(
      eventWithUrl("https://board.example.com/verify?token=abc123&next=/"),
    );
    expect(scrubbed.request?.url).toBe(
      "https://board.example.com/verify?token=[redacted]&next=/",
    );
  });

  it("keeps the rest of the path, which is what makes the report useful", () => {
    const scrubbed = scrubEvent(
      eventWithUrl("https://board.example.com/trips/abc-123?tab=chat"),
    );
    expect(scrubbed.request?.url).toBe(
      "https://board.example.com/trips/abc-123?tab=chat",
    );
  });

  it("redacts breadcrumb urls too, not only the event's own", () => {
    // A crash reached from an invite link carries the invite in its trail even
    // when the URL at the moment of the throw is innocent.
    const event = {
      type: undefined,
      request: { url: "https://board.example.com/trips/abc-123" },
      breadcrumbs: [
        { data: { url: "https://board.example.com/join/RtEr8xQ2kLmN" } },
        { data: { url: "https://board.example.com/verify?token=abc123" } },
        { message: "no url here" },
      ],
    } as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.breadcrumbs?.[0]?.data?.["url"]).toBe(
      "https://board.example.com/join/[token]",
    );
    expect(scrubbed.breadcrumbs?.[1]?.data?.["url"]).toBe(
      "https://board.example.com/verify?token=[redacted]",
    );
  });

  it("tolerates an event with no request or breadcrumbs", () => {
    const event = { type: undefined } as ErrorEvent;
    expect(() => scrubEvent(event)).not.toThrow();
  });
});
