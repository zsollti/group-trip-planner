import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { t, plural, pickForm, translateUi } from "./i18n";
import { UI_MESSAGES, UI_TRANSLATIONS } from "./ui-messages";

/**
 * The board's words, and the machinery that will translate them.
 *
 * Two very different jobs here. The renderer is pure, so it is exercised against a
 * **fabricated** Hungarian catalogue — the only way to prove translation works at
 * all while the real one is empty. The rest reads the board's own source, because
 * using the English sentence as the key buys a readable component and costs a
 * coupling: reword the sentence and its translation silently stops matching. A
 * list nobody checks is worse than no list.
 *
 * The frozen-at-import scan is here because it caught five real bugs. It is the
 * kind of mistake that cannot be seen in review — the code looks identical whether
 * it sits inside a function or beside it.
 */

/**
 * The board's source tree, resolved from this file.
 *
 * `fileURLToPath` and not `new URL(...).pathname.slice(1)`. That slice is the
 * Windows fix — a file URL there is `/D:/tdk/...`, and the leading slash has to go —
 * and it is precisely wrong on Linux, where it eats the **root** slash and yields
 * `home/runner/work/...`. The suite passed on my machine and failed in CI with
 * ENOENT on a path missing its first character, which is the only way that bug ever
 * announces itself.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      out.push(path);
  }
  return out;
}

const CATALOGUE = /[\\/](i18n|ui-messages)\.ts$/;
const TRANSLATORS = ["t", "tNode", "plural"];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Every literal handed to t() / tNode() / plural() in the board. */
function translatedLiterals(): { text: string; file: string }[] {
  const found: { text: string; file: string }[] = [];
  for (const file of sources(SRC)) {
    if (CATALOGUE.test(file)) continue;
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const args =
          name === "t" || name === "tNode"
            ? node.arguments.slice(0, 1)
            : name === "plural"
              ? node.arguments.slice(1, 3)
              : [];
        for (const arg of args) {
          if (
            ts.isStringLiteral(arg) ||
            ts.isNoSubstitutionTemplateLiteral(arg)
          ) {
            found.push({ text: arg.text, file });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

describe("translating a message", () => {
  it("returns the source string in the source language, with no lookup", () => {
    // English is never a catalogue entry: translating into it is the identity, and
    // 507 strings mapped to themselves would be 507 chances to disagree.
    expect(translateUi("Plan your first trip", "en")).toBe(
      "Plan your first trip",
    );
  });

  it("uses the catalogue for another language", () => {
    // This asserted the English fallback until the dictionary landed, which is
    // exactly what it should have done then: an empty catalogue must degrade rather
    // than blank the screen. It now asserts the translation, and the change of
    // expectation is the clearest evidence in the suite that Hungarian is live.
    expect(translateUi("Plan your first trip", "hu" as never)).toBe(
      "Tervezd meg az első utazásod",
    );
  });

  it("still falls back for a string no catalogue holds", () => {
    expect(translateUi("nothing has ever said this", "hu" as never)).toBe(
      "nothing has ever said this",
    );
  });

  it("interpolates values into the pattern", () => {
    expect(t("Welcome, {name}", { name: "Ada" })).toBe("Welcome, Ada");
    expect(t("{n} unread", { n: 3 })).toBe("3 unread");
  });

  it("leaves an unknown placeholder visible rather than crashing", () => {
    // A brace on screen is a review-time bug. A thrown error is an outage.
    expect(t("Welcome, {name}")).toBe("Welcome, {name}");
  });
});

describe("counted phrases", () => {
  it("agrees with the number in English", () => {
    expect(plural(1, "{n} member", "{n} members")).toBe("1 member");
    expect(plural(4, "{n} member", "{n} members")).toBe("4 members");
    expect(plural(0, "{n} member", "{n} members")).toBe("0 members");
  });

  it("takes the singular wording after any numeral in Hungarian", () => {
    // `2 tag`, never `2 tagok`. A numeral is already the plural marker, so the
    // noun does not repeat it — which is why the rule has to be per language and
    // not `count === 1`.
    expect(pickForm("hu" as never, 1)).toBe("one");
    expect(pickForm("hu" as never, 7)).toBe("one");
    expect(pickForm("en", 1)).toBe("one");
    expect(pickForm("en", 7)).toBe("many");
  });
});

describe("the catalogue matches the code", () => {
  it("holds every string the board asks it to translate", () => {
    const known = new Set<string>(UI_MESSAGES);
    const missing = translatedLiterals()
      .filter(({ text }) => !known.has(text))
      .map(
        ({ text, file }) =>
          `${text}  (${file.replace(/\\/g, "/").split("/src/")[1]})`,
      );
    expect(missing).toEqual([]);
  });

  it("has no entry the board stopped saying", () => {
    // The direction that catches a reworded sentence: the old one lingers, and a
    // translator keeps translating something nobody can ever see.
    const used = new Set(translatedLiterals().map((m) => m.text));
    expect(UI_MESSAGES.filter((m) => !used.has(m))).toEqual([]);
  });

  it("is sorted and unique, so a diff shows what changed", () => {
    // Codepoint order, not `localeCompare`: the locale-aware collation is nicer to
    // read but locale-dependent, which is a poor property for a list whose job is
    // legible diffs.
    expect([...UI_MESSAGES]).toEqual([...UI_MESSAGES].sort());
    expect(new Set(UI_MESSAGES).size).toBe(UI_MESSAGES.length);
  });

  it("holds no CSS class name, however much one looks like a phrase", () => {
    // 26 of these got in, and neither the type checker nor 432 rendering tests
    // could see them: `className={"lane__card" + (dragging ? " lane__card--dragging"
    // : "")}` puts a class fragment in a ternary branch, and " lane__card--dragging"
    // has a space and letters, which is all "looks like prose" ever meant. `t()`
    // returned them unchanged so nothing broke — but they were in the catalogue, one
    // plausible-looking translation away from unstyling the board.
    const cssish = UI_MESSAGES.filter(
      (m) => /__|--/.test(m) || /^\s\S+$/.test(m) || m.startsWith("(prefers-"),
    );
    expect(cssish).toEqual([]);
  });

  it("carries no translations for the source language", () => {
    expect(UI_TRANSLATIONS.en).toBeUndefined();
  });
});

describe("no message is frozen at import", () => {
  it("never calls a translator at module scope", () => {
    // `t()` outside a function runs once, when the bundle loads, and holds
    // whichever language was active then — so those words would stay put while the
    // rest of the screen followed the reader. Five of these existed at one point,
    // all in one `const STEPS = [...]`, and none of them is visible in review.
    const frozen: string[] = [];
    for (const file of sources(SRC)) {
      const sf = parse(file);
      const visit = (node: ts.Node, insideFunction: boolean): void => {
        const isFn =
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node);
        if (
          !insideFunction &&
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          TRANSLATORS.includes(node.expression.text)
        ) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          frozen.push(
            `${file.replace(/\\/g, "/").split("/src/")[1]}:${line + 1}  ${node
              .getText(sf)
              .slice(0, 50)}`,
          );
        }
        ts.forEachChild(node, (child) => visit(child, insideFunction || isFn));
      };
      visit(sf, false);
    }
    expect(frozen).toEqual([]);
  });
});

describe("the Hungarian catalogue", () => {
  const hu = UI_TRANSLATIONS.hu ?? {};

  it("translates every string the board can show", () => {
    expect(UI_MESSAGES.filter((m) => !(m in hu))).toEqual([]);
  });

  it("keeps every placeholder the English carried", () => {
    // The one translator error a reader cannot recover from: drop {n} and the
    // sentence quietly stops naming the number it is about.
    const holes = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    const wrong = Object.entries(hu)
      .filter(
        ([source, target]) => holes(source).join() !== holes(target).join(),
      )
      .map(([source]) => source);
    expect(wrong).toEqual([]);
  });

  it("does not merely echo the English back", () => {
    // A copy-paste would satisfy every check above. Proper nouns and symbols are
    // allowed to match; a whole sentence is not.
    const echoed = Object.entries(hu)
      .filter(([source, target]) => source.length > 24 && source === target)
      .map(([source]) => source);
    expect(echoed).toEqual([]);
  });

  it("gives a counted phrase the same wording in both forms", () => {
    // Hungarian takes no plural after a numeral, so "{n} member" and "{n} members"
    // must translate to the same thing — and `plural()` is what makes picking
    // either of them correct rather than arbitrary.
    const pairs: [string, string][] = [
      ["{n} member", "{n} members"],
      ["{n} night", "{n} nights"],
      ["{n} attempt", "{n} attempts"],
      ["{n} decision pending", "{n} decisions pending"],
      ["{n} decision placed", "{n} decisions placed"],
    ];
    for (const [one, many] of pairs) {
      expect(hu[one], `${one} vs ${many}`).toBe(hu[many]);
    }
  });
});
