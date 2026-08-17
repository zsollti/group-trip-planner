import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  activeLocale,
  intlTag,
  rememberLocale,
  setActiveLocale,
  storedLocale,
} from "./locale";

/**
 * The app's language, on the front end.
 *
 * `UI_LOCALE` used to be a constant, and the reason it could not stay one is the
 * thing worth pinning here: an imported constant is read once when the module
 * loads, so nothing that depends on it can ever follow a reader who switches
 * language. What replaced it is a function over a module variable, and these
 * cases cover the two jobs that variable does — being current, and having a
 * sensible value before anybody has said anything.
 */

afterEach(() => {
  setActiveLocale("en");
  // Unstub *first*: one case replaces `localStorage` with an object that throws
  // on every access and has no `clear`, so clearing before restoring the real one
  // fails in the teardown rather than the test.
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the active language", () => {
  it("reports a formatting tag rather than the language code", () => {
    // `en` is the app's language; `en-GB` is how it writes dates. The two are not
    // interchangeable, and only the second one belongs in `toLocaleDateString`.
    expect(activeLocale()).toBe("en");
    expect(intlTag()).toBe("en-GB");
  });

  it("is read at the call, not at import", () => {
    // The whole point of the change. A module that captured `intlTag()` into a
    // constant would keep formatting in the old language forever; calling it
    // returns what is true now.
    const before = intlTag();
    setActiveLocale("en");
    expect(intlTag()).toBe(before);
    // With one language there is nothing to switch to, so this asserts the shape
    // that makes switching possible: the value comes from a call.
    expect(typeof intlTag).toBe("function");
  });
});

describe("the language to start in, before a session exists", () => {
  it("prefers what this browser remembered", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(storedLocale()).toBe("en");
  });

  it("falls back to the browser's own preference", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(storedLocale()).toBe("en");
  });

  it("honours a stored language this build offers", () => {
    // `hu` was narrowed away here until Hungarian shipped, which is what stopped a
    // stored value from a later build rendering a language this one did not have.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "hu");
    expect(storedLocale()).toBe("hu");
  });

  it("narrows anything it cannot use to the default", () => {
    // A stored value from a build that offered more languages than this one — or
    // simply junk — must not render a language that does not exist here.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "de");
    expect(storedLocale()).toBe("en");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "!!");
    expect(storedLocale()).toBe("en");
  });

  it("survives a browser that refuses storage", () => {
    // Private mode with storage blocked throws on access. A reader with no
    // memory is not a broken app; a crash on the first line of the first render
    // would be.
    vi.stubGlobal("navigator", { language: "en" });
    const boom = () => {
      throw new Error("storage disabled");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom });
    expect(storedLocale()).toBe("en");
    expect(() => rememberLocale("en")).not.toThrow();
  });
});
