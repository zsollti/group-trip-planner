import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  EMAIL_MESSAGES,
  SEED_MESSAGES,
  SERVER_MESSAGES,
  TRANSLATIONS,
  UNTRANSLATED_MESSAGES,
  interpolate,
  translate,
  type MessageCatalogue,
} from "../src/i18n/messages.js";
import { BUILTIN_CATEGORIES } from "@gtp/types";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { readerLocale } from "../src/i18n/reader-locale.js";
import {
  localizedException,
  localizedPattern,
} from "../src/i18n/localized-message.js";

/**
 * The server's own dictionary (post-launch).
 *
 * Two halves are tested very differently. The renderer is pure, so it is
 * exercised against a **fabricated** Hungarian catalogue — which is the only way
 * to prove translation works at all in a build whose real catalogue is empty. The
 * inventory is checked against the API's own source, because the weakness of
 * using English text as the key is that rewording a message silently orphans its
 * translation, and a list nobody maintains is worse than no list.
 */

/** A catalogue that does not exist yet, so the machinery can be proven anyway. */
const FAKE: MessageCatalogue = {
  hu: {
    "Trip not found": "Az utazás nem található",
    "This board is at its limit of {cap} categories. Delete one to add another.":
      "Ez a tábla elérte a {cap} kategóriás korlátot. Törölj egyet.",
  },
};

describe("translate", () => {
  it("renders a message in the reader's language", () => {
    assert.equal(
      translate("Trip not found", "hu" as never, FAKE),
      "Az utazás nem található",
    );
  });

  it("returns the source string for the source language, without a lookup", () => {
    // English is never a catalogue entry — translating into the source language is
    // the identity, and a `Record<"en", …>` of 58 strings to themselves would be
    // 58 more chances for the catalogue to disagree with the code.
    assert.equal(translate("Trip not found", "en", FAKE), "Trip not found");
  });

  it("falls back to the source string rather than showing a key or nothing", () => {
    // Three ways to have no translation, one behaviour: an untranslated sentence
    // is a smaller failure than a missing one.
    assert.equal(
      translate("Option not found", "hu" as never, FAKE),
      "Option not found",
    );
    assert.equal(
      translate("Option not found", "hu" as never, {}),
      "Option not found",
    );
    assert.equal(
      translate("something composed at runtime", "hu" as never, FAKE),
      "something composed at runtime",
    );
  });
});

describe("interpolate", () => {
  it("fills a translated pattern with the values that travelled beside it", () => {
    // The order matters and this is what pins it: translate first, then fill in.
    // Interpolating at the throw site would leave "…limit of 12 categories…",
    // which is not a key anybody can translate.
    const pattern =
      "This board is at its limit of {cap} categories. Delete one to add another.";
    assert.equal(
      interpolate(translate(pattern, "hu" as never, FAKE), { cap: 12 }),
      "Ez a tábla elérte a 12 kategóriás korlátot. Törölj egyet.",
    );
  });

  it("replaces every occurrence, and leaves unknown braces alone", () => {
    assert.equal(
      interpolate("{a} and {a} and {b}", { a: 1 }),
      "1 and 1 and {b}",
    );
  });

  it("is a no-op without params", () => {
    assert.equal(interpolate("Trip not found"), "Trip not found");
  });
});

describe("a parameterised message on its way to the filter", () => {
  it("is an ordinary Nest exception, in ordinary English", () => {
    // The property that matters, and the one two earlier attempts lacked. Four
    // readers depend on it: Nest, which builds `{ statusCode, message, error }`;
    // anything that classifies by exception type; the log line; and Sentry. A raw
    // pattern in the message made all four worse in exchange for a translation
    // none of them wanted.
    const e = localizedException(
      (message) => new BadRequestException(message),
      "Invalid {name}",
      { name: "after" },
    );
    assert.ok(e instanceof BadRequestException);
    assert.equal(e.message, "Invalid after");
    assert.deepEqual(e.getResponse(), {
      statusCode: 400,
      message: "Invalid after",
      error: "Bad Request",
    });
  });

  it("carries the pattern where only the filter looks", () => {
    const e = localizedException(
      (message) => new ForbiddenException(message),
      "…limit of {cap} categories…",
      { cap: 12 },
    );
    assert.deepEqual(localizedPattern(e), {
      pattern: "…limit of {cap} categories…",
      params: { cap: 12 },
    });
    // Non-enumerable, so it cannot end up in a JSON body or a log dump.
    assert.deepEqual(
      Object.keys(e).filter((k) => k.includes("attern")),
      [],
    );
    assert.equal(JSON.stringify({ ...e }).includes("{cap}"), false);
  });

  it("finds no pattern on an ordinary exception, or on anything else", () => {
    assert.equal(
      localizedPattern(new BadRequestException("Invalid cursor")),
      null,
    );
    for (const other of [null, undefined, "text", 42, {}]) {
      assert.equal(localizedPattern(other), null, `value: ${String(other)}`);
    }
  });
});

describe("readerLocale", () => {
  it("prefers the signed-in account over the header", () => {
    // They disagree whenever someone chose a language in the app that their
    // browser does not ask for, which is the whole reason the setting exists.
    assert.equal(
      readerLocale({
        user: { locale: "en" },
        headers: { "accept-language": "hu-HU,hu;q=0.9" },
      }),
      "en",
    );
  });

  it("falls back to the header when there is no account yet", () => {
    // Register, login, verify and invite-join: nobody is signed in on any of
    // them, and they are where a wrong-language error is least recoverable.
    assert.equal(
      readerLocale({ headers: { "accept-language": "en-GB,en;q=0.9" } }),
      "en",
    );
  });

  it("survives a request with neither, and a repeated header", () => {
    assert.equal(readerLocale(undefined), "en");
    assert.equal(readerLocale({}), "en");
    assert.equal(readerLocale({ user: null, headers: {} }), "en");
    // Node hands back an array when a header appears twice.
    assert.equal(
      readerLocale({ headers: { "accept-language": ["en", "de"] } }),
      "en",
    );
  });
});

/**
 * The self-maintaining half.
 *
 * Using the English text as the translation key buys a readable throw site and
 * costs a coupling: reword the sentence and the translation stops matching, with
 * nothing to say so. This closes that by reading the API's own source — the same
 * trick as the admin IDOR sweep, which reads Express's route table so an
 * unguarded new route cannot ship quietly.
 */
describe("the message inventory covers the code", () => {
  // Up out of `dist-test/test` to the package root, then into the **real** source
  // tree. Resolved from this file rather than from `process.cwd()`, which differs
  // between `pnpm --filter` and a bare `node --test`.
  //
  // The obvious `join(dirname, "..", "src")` is wrong in a way that passes: it
  // lands in `dist-test/src`, which holds compiled `.js` and so matches no `.ts`
  // file at all — the scan finds zero messages and "every message is in the
  // inventory" is vacuously true. Only the reverse check below caught it.
  const SRC = join(import.meta.dirname, "..", "..", "src");

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (path.endsWith(".ts")) out.push(path);
    }
    return out;
  }

  /** Every `new …Exception("literal")` in the API, with the file it came from. */
  function thrownLiterals(): { text: string; file: string }[] {
    const dq = String.raw`"(?:[^"\\]|\\.)*"`;
    const sq = String.raw`'(?:[^'\\]|\\.)*'`;
    const re = new RegExp(
      String.raw`new\s+\w*Exception\s*\(\s*(?:\/\/[^\n]*\n\s*)?(` +
        dq +
        "|" +
        sq +
        ")",
      "g",
    );
    const found: { text: string; file: string }[] = [];
    for (const file of sources(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(re)) {
        const raw = match[1]!;
        found.push({
          text: raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'"),
          file,
        });
      }
    }
    return found;
  }

  it("knows every message the API throws", () => {
    const inventory = new Set<string>(SERVER_MESSAGES);
    const missing = thrownLiterals().filter(
      ({ text }) =>
        !inventory.has(text) &&
        !UNTRANSLATED_MESSAGES.some((exempt) => text.startsWith(exempt)),
    );
    assert.deepEqual(
      missing.map((m) => `${m.text}  (${m.file})`),
      [],
      "add these to SERVER_MESSAGES, or to UNTRANSLATED_MESSAGES with a reason",
    );
  });

  it("has no entry the API stopped throwing", () => {
    // The other direction, which is what catches a reworded message: the old
    // sentence is still in the inventory, and a translator would keep translating
    // something nobody can ever see.
    const thrown = new Set(thrownLiterals().map((m) => m.text));
    const patterns = SERVER_MESSAGES.filter((m) => m.includes("{"));
    const stale = SERVER_MESSAGES.filter(
      (m) => !thrown.has(m) && !patterns.includes(m),
    );
    assert.deepEqual(
      stale,
      [],
      "these are in the inventory but nothing throws them",
    );
  });

  it("accounts for every pattern, since a pattern is never thrown verbatim", () => {
    // A `{placeholder}` message reaches the filter inside a LocalizedMessage, so
    // the scan above cannot see it. Each one must still be raised somewhere, or it
    // is dead prose — checked by looking for the pattern's own text in the source.
    const all = sources(SRC)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const pattern of SERVER_MESSAGES.filter((m) => m.includes("{"))) {
      assert.ok(
        all.includes(pattern),
        `no throw site passes the pattern: ${pattern}`,
      );
    }
  });

  it("lists the seeded lane names, and keeps them the seed set's own", () => {
    // These are not thrown either — they are written into a new trip's lanes.
    // The seed set in `@gtp/types` is the definition; an inventory that drifts
    // from it would translate a name nothing seeds and seed a name nothing
    // translates, and both failures are silent.
    assert.deepEqual(
      [...SEED_MESSAGES].sort(),
      BUILTIN_CATEGORIES.map((c) => c.name).sort(),
    );
  });

  it("lists the email prose separately, and keeps it in use", () => {
    // Not thrown, so the scan cannot cover these — but an email string that no
    // template uses is the same dead weight for a translator.
    const emails = readFileSync(join(SRC, "email", "email.service.ts"), "utf8");
    for (const message of EMAIL_MESSAGES) {
      assert.ok(emails.includes(message), `no email uses: ${message}`);
    }
  });

  it("is sorted and unique, so a diff shows what changed", () => {
    // Plain codepoint order, not `localeCompare`. The locale-aware collation is
    // the nicer reading order for a person — case-insensitive, punctuation first —
    // but it is also **locale-dependent**, which is a poor property for a list
    // whose whole job is to make diffs legible: the same file would be "unsorted"
    // under a different collation. This ordering is the one every machine agrees
    // on, and an editor can always sort a block with it.
    for (const list of [SERVER_MESSAGES, EMAIL_MESSAGES, SEED_MESSAGES]) {
      assert.deepEqual(
        [...list],
        [...list].sort(),
        "keep the inventory sorted",
      );
      assert.equal(new Set(list).size, list.length, "no duplicates");
    }
  });
});

/**
 * Hungarian's coverage of the inventory.
 *
 * The dictionary is keyed by English sentences, so the failure mode is silence: a
 * missing entry falls back to English and nothing complains. That is right at
 * runtime and useless at review time, which is what this is for.
 */
describe("the Hungarian catalogue", () => {
  const hu = TRANSLATIONS.hu ?? {};

  it("translates every message the API can throw", () => {
    // `database unreachable` is deliberately left English — see the note in `hu.ts`.
    const untranslated = SERVER_MESSAGES.filter(
      (m) => !(m in hu) && m !== "database unreachable",
    );
    assert.deepEqual(untranslated, []);
  });

  it("translates every sentence in the emails", () => {
    assert.deepEqual(
      EMAIL_MESSAGES.filter((m) => !(m in hu)),
      [],
    );
  });

  it("translates every lane a new trip is seeded with", () => {
    // Seeded data rather than a sentence, and the failure is quieter than the
    // others: a missing entry does not fall back to English *once*, it writes
    // English into somebody's board for good.
    assert.deepEqual(
      SEED_MESSAGES.filter((m) => !(m in hu)),
      [],
    );
  });

  it("keeps every placeholder the English carried", () => {
    // The one error a translator makes that a reader cannot recover from: drop
    // `{cap}` and the sentence quietly stops naming the number it is about.
    const holes = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    const wrong: string[] = [];
    for (const [source, target] of Object.entries(hu)) {
      if (holes(source).join() !== holes(target).join()) {
        wrong.push(`${source}  →  ${target}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it("translates into Hungarian rather than echoing the English", () => {
    // A copy-paste that left the source text in place would satisfy every check
    // above. Hungarian uses letters English does not; every sentence long enough to
    // say anything should contain one.
    const suspicious = Object.entries(hu)
      .filter(([source, target]) => source.length > 25 && source === target)
      .map(([source]) => source);
    assert.deepEqual(suspicious, []);
  });
});
