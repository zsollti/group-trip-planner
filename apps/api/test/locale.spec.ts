import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  INTL_TAG,
  LOCALES,
  LOCALE_LABEL,
  intlTagFor,
  localeSchema,
  resolveLocale,
} from "@gtp/types";

/**
 * The interface's language (post-launch) — the pure half.
 *
 * `resolveLocale` is the only door an untrusted language string comes through,
 * and it has three very different callers: a stored column, a browser's
 * `navigator.language`, and an `Accept-Language` header. The header is the awkward
 * one, and the reason this is a function rather than a lookup.
 */

describe("resolveLocale", () => {
  it("takes a bare tag this build offers", () => {
    assert.equal(resolveLocale("en"), "en");
  });

  it("ignores the region, which is not the language", () => {
    // `navigator.language` is a full tag. An American reader and a British one
    // read the same English.
    assert.equal(resolveLocale("en-US"), "en");
    assert.equal(resolveLocale("EN-gb"), "en");
  });

  it("reads an Accept-Language list in order", () => {
    // The header's real shape, q-values and all.
    assert.equal(resolveLocale("hu-HU,hu;q=0.9,en;q=0.8"), "en");
    assert.equal(resolveLocale("en-GB,en;q=0.9"), "en");
  });

  it("falls back rather than failing on anything it cannot use", () => {
    // Absent, empty, junk, and a language this build does not offer all mean the
    // same thing: nobody has expressed a preference we can honour. None of them
    // is an error — an unreadable preference is an absent one.
    for (const input of [null, undefined, "", "  ", "de", "hu", "!!", ",,,"]) {
      assert.equal(resolveLocale(input), DEFAULT_LOCALE, `input: ${input}`);
    }
  });

  it("refuses a language this build has not translated", () => {
    // The guard that keeps a half-English screen unreachable: the tag table
    // knows about Hungarian, but `LOCALES` is what the schema validates against,
    // so it cannot be selected until a dictionary puts it there.
    assert.equal(localeSchema.safeParse("en").success, true);
    assert.equal(localeSchema.safeParse("hu").success, false);
    assert.ok(!LOCALES.includes("hu" as never));
    assert.equal(
      INTL_TAG.hu,
      "hu-HU",
      "its formatting is already known, though",
    );
  });
});

describe("a language's formatting and name", () => {
  it("formats English dates the way the app draws them", () => {
    // en-GB, not en-US: day before month, matching the calendar grid, and a
    // 24-hour clock, matching the option form's time list.
    assert.equal(intlTagFor("en"), "en-GB");
    const d = new Date("2026-08-17T13:05:00.000Z");
    assert.equal(
      d.toLocaleDateString(intlTagFor("en"), {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      "17 Aug",
    );
    assert.equal(
      d.toLocaleTimeString(intlTagFor("en"), {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }),
      "13:05",
    );
  });

  it("names every offered language in that language", () => {
    // An endonym: a reader looking for their own language scans for the word they
    // would use for it, and "Hungarian" helps nobody who cannot read the rest of
    // the screen.
    for (const l of LOCALES) {
      assert.ok(LOCALE_LABEL[l].length > 0);
    }
    assert.equal(LOCALE_LABEL.en, "English");
    assert.equal(LOCALE_LABEL.hu, "Magyar");
  });
});
